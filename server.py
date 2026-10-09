import os
import json
import sqlite3
import secrets
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from database import init_db, get_db, hash_password, verify_password

PORT = int(os.environ.get("PORT", 8080))
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

class AceiteRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, default=str).encode('utf-8'))

    def _read_json_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length > 0:
            body = self.rfile.read(content_length).decode('utf-8')
            return json.loads(body)
        return {}

    def _get_auth_user(self):
        auth_header = self.headers.get('Authorization', '')
        token = ''
        if auth_header.startswith('Bearer '):
            token = auth_header[7:].strip()
        elif 'token=' in self.headers.get('Cookie', ''):
            cookies = dict(c.strip().split('=', 1) for c in self.headers.get('Cookie', '').split(';') if '=' in c)
            token = cookies.get('token', '')

        if not token:
            return None

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT u.id, u.name, u.username, u.role, u.active 
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ? AND u.active = 1
        ''', (token,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return dict(row)
        return None

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path.startswith('/api/'):
            self.handle_api_get(path, query)
        else:
            # Roteamento de páginas SPA / Arquivos Estáticos
            if path == '/' or not os.path.exists(os.path.join(STATIC_DIR, path.lstrip('/'))):
                self.path = '/index.html'
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith('/api/'):
            self.handle_api_post(path)
        else:
            self._send_json({'error': 'Rota não encontrada'}, 404)

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith('/api/'):
            self.handle_api_put(path)
        else:
            self._send_json({'error': 'Rota não encontrada'}, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith('/api/'):
            self.handle_api_delete(path)
        else:
            self._send_json({'error': 'Rota não encontrada'}, 404)

    # ================= ROTAS DE API =================
    def handle_api_get(self, path, query):
        user = self._get_auth_user()

        # Rota de verificação do usuário atual
        if path == '/api/auth/me':
            if not user:
                return self._send_json({'authenticated': False}, 401)
            return self._send_json({'authenticated': True, 'user': user})

        if not user:
            return self._send_json({'error': 'Não autenticado'}, 401)

        # Listagem de Reservas com Filtros
        if path == '/api/reservations':
            conn = get_db()
            cursor = conn.cursor()
            
            sql = "SELECT * FROM reservations WHERE 1=1"
            params = []

            # Se for vendedor, pode ver todas ou restringir? O usuário pediu:
            # "o vendedor vai realizar o lançamento... usuario que vai analisar apenas as vendas... admin administra tudo"
            # Vamos permitir que vendedor veja tudo para conferência da sua produção e da empresa, com filtros.
            
            if 'hotel' in query and query['hotel'][0]:
                sql += " AND hotel = ?"
                params.append(query['hotel'][0])
            if 'empresa' in query and query['empresa'][0]:
                sql += " AND empresa = ?"
                params.append(query['empresa'][0])
            if 'usuario' in query and query['usuario'][0]:
                sql += " AND usuario LIKE ?"
                params.append(f"%{query['usuario'][0]}%")
            if 'baixa_almaz' in query and query['baixa_almaz'][0]:
                sql += " AND baixa_almaz = ?"
                params.append(query['baixa_almaz'][0])
            if 'search' in query and query['search'][0]:
                term = f"%{query['search'][0]}%"
                sql += " AND (hospede LIKE ? OR reserva_cod LIKE ?)"
                params.extend([term, term])
            if 'start_date' in query and query['start_date'][0]:
                sql += " AND data_criacao >= ?"
                params.append(query['start_date'][0])
            if 'end_date' in query and query['end_date'][0]:
                sql += " AND data_criacao <= ?"
                params.append(query['end_date'][0])

            sql += " ORDER BY data_criacao DESC, id DESC"
            cursor.execute(sql, params)
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()
            return self._send_json({'reservations': rows})

        # Métricas e Estatísticas do Dashboard
        if path == '/api/dashboard/metrics':
            conn = get_db()
            cursor = conn.cursor()

            # Período filtro se enviado
            start_date = query.get('start_date', [None])[0]
            end_date = query.get('end_date', [None])[0]
            
            filter_sql = ""
            params = []
            if start_date and end_date:
                filter_sql = " WHERE data_criacao BETWEEN ? AND ?"
                params = [start_date, end_date]

            # Totais Gerais
            cursor.execute(f'''
                SELECT 
                    COUNT(*) as total_reservas,
                    COALESCE(SUM(valor), 0) as total_faturamento,
                    COALESCE(AVG(valor), 0) as ticket_medio,
                    COALESCE(SUM(qtde_hospedes), 0) as total_hospedes,
                    COALESCE(SUM(qtde_diarias), 0) as total_diarias
                FROM reservations {filter_sql}
            ''', params)
            general = dict(cursor.fetchone())

            # Totais por Dia (Últimos 30 lançamentos/dias)
            cursor.execute(f'''
                SELECT data_criacao as data, COUNT(*) as qtd, SUM(valor) as total
                FROM reservations {filter_sql}
                GROUP BY data_criacao
                ORDER BY data_criacao ASC
                LIMIT 30
            ''', params)
            by_day = [dict(r) for r in cursor.fetchall()]

            # Totais por Mês (Ano atual)
            cursor.execute(f'''
                SELECT substr(data_criacao, 1, 7) as mes, COUNT(*) as qtd, SUM(valor) as total
                FROM reservations {filter_sql}
                GROUP BY mes
                ORDER BY mes ASC
            ''', params)
            by_month = [dict(r) for r in cursor.fetchall()]

            # Totais por Ano
            cursor.execute(f'''
                SELECT substr(data_criacao, 1, 4) as ano, COUNT(*) as qtd, SUM(valor) as total
                FROM reservations {filter_sql}
                GROUP BY ano
                ORDER BY ano ASC
            ''', params)
            by_year = [dict(r) for r in cursor.fetchall()]

            # Por Hotel
            cursor.execute(f'''
                SELECT hotel, COUNT(*) as qtd, SUM(valor) as total
                FROM reservations {filter_sql}
                GROUP BY hotel
                ORDER BY total DESC
            ''', params)
            by_hotel = [dict(r) for r in cursor.fetchall()]

            # Por Vendedor / Usuário
            cursor.execute(f'''
                SELECT usuario, COUNT(*) as qtd, SUM(valor) as total
                FROM reservations {filter_sql}
                GROUP BY usuario
                ORDER BY total DESC
            ''', params)
            by_seller = [dict(r) for r in cursor.fetchall()]

            # Por Empresa
            cursor.execute(f'''
                SELECT empresa, COUNT(*) as qtd, SUM(valor) as total
                FROM reservations {filter_sql}
                GROUP BY empresa
                ORDER BY total DESC
            ''', params)
            by_company = [dict(r) for r in cursor.fetchall()]

            # Status Baixa Almaz
            cursor.execute(f'''
                SELECT COALESCE(NULLIF(baixa_almaz, ''), 'Não Definido') as status, COUNT(*) as qtd, SUM(valor) as total
                FROM reservations {filter_sql}
                GROUP BY baixa_almaz
            ''', params)
            by_baixa = [dict(r) for r in cursor.fetchall()]

            conn.close()
            return self._send_json({
                'general': general,
                'by_day': by_day,
                'by_month': by_month,
                'by_year': by_year,
                'by_hotel': by_hotel,
                'by_seller': by_seller,
                'by_company': by_company,
                'by_baixa': by_baixa
            })

        # Listagem de Usuários (Apenas Administrador)
        if path == '/api/users':
            if user['role'] != 'admin':
                return self._send_json({'error': 'Acesso restrito ao administrador'}, 403)
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute('SELECT id, name, username, role, active, created_at FROM users ORDER BY id DESC')
            users = [dict(r) for r in cursor.fetchall()]
            conn.close()
            return self._send_json({'users': users})

        # Opções dinâmicas para formulários (Hotéis cadastrados, Empresas, Vendedores)
        if path == '/api/form-options':
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute('SELECT DISTINCT hotel FROM reservations WHERE hotel != "" ORDER BY hotel')
            hotels = [r[0] for r in cursor.fetchall()]
            cursor.execute('SELECT DISTINCT empresa FROM reservations WHERE empresa != "" ORDER BY empresa')
            empresas = [r[0] for r in cursor.fetchall()]
            cursor.execute('SELECT name FROM users WHERE role = "vendedor" OR role = "admin" ORDER BY name')
            sellers = [r[0] for r in cursor.fetchall()]
            conn.close()

            # Adicionar defaults caso a lista inicial esteja vazia
            if not hotels:
                hotels = ["Solar das Águas", "Olímpia Park", "Thermas de Olímpia Resorts", "Hot Beach Resort"]
            if not empresas:
                empresas = ["Olímpia", "Sunny", "Solar", "Ômega"]

            return self._send_json({
                'hotels': hotels,
                'empresas': empresas,
                'sellers': sellers
            })

        self._send_json({'error': 'Endpoint não encontrado'}, 404)

    def handle_api_post(self, path):
        body = self._read_json_body()

        # Login
        if path == '/api/auth/login':
            username = body.get('username', '').strip()
            password = body.get('password', '')

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute('SELECT id, name, username, password_hash, role, active FROM users WHERE username = ?', (username,))
            user_row = cursor.fetchone()

            if not user_row or not verify_password(user_row['password_hash'], password):
                conn.close()
                return self._send_json({'error': 'Usuário ou senha inválidos'}, 401)

            if not user_row['active']:
                conn.close()
                return self._send_json({'error': 'Este usuário foi desativado pelo administrador'}, 403)

            token = secrets.token_hex(32)
            cursor.execute('''
                INSERT INTO sessions (token, user_id, role, username, name)
                VALUES (?, ?, ?, ?, ?)
            ''', (token, user_row['id'], user_row['role'], user_row['username'], user_row['name']))
            conn.commit()
            conn.close()

            return self._send_json({
                'token': token,
                'user': {
                    'id': user_row['id'],
                    'name': user_row['name'],
                    'username': user_row['username'],
                    'role': user_row['role']
                }
            })

        user = self._get_auth_user()
        if not user:
            return self._send_json({'error': 'Não autenticado'}, 401)

        # Logout
        if path == '/api/auth/logout':
            auth_header = self.headers.get('Authorization', '')
            token = auth_header[7:].strip() if auth_header.startswith('Bearer ') else ''
            if token:
                conn = get_db()
                conn.execute('DELETE FROM sessions WHERE token = ?', (token,))
                conn.commit()
                conn.close()
            return self._send_json({'success': True})

        # Nova Reserva (Vendedor ou Admin)
        if path == '/api/reservations':
            if user['role'] not in ('admin', 'vendedor'):
                return self._send_json({'error': 'Você não tem permissão para lançar reservas (apenas vendedores e administradores)'}, 403)

            reserva_cod = str(body.get('reserva_cod', '')).strip()
            hospede = str(body.get('hospede', '')).strip()
            data_criacao = str(body.get('data_criacao', '')).strip() or datetime.now().strftime('%Y-%m-%d')
            checkin = str(body.get('checkin', '')).strip()
            checkout = str(body.get('checkout', '')).strip()
            hotel = str(body.get('hotel', '')).strip()
            empresa = str(body.get('empresa', '')).strip()
            baixa_almaz = str(body.get('baixa_almaz', 'Pendente')).strip()
            
            try:
                valor = float(body.get('valor', 0))
                qtde_hospedes = int(body.get('qtde_hospedes', 1))
                qtde_diarias = int(body.get('qtde_diarias', 1))
            except ValueError:
                return self._send_json({'error': 'Valores numéricos inválidos'}, 400)

            # Vendedor é quem está logado ou definido
            vendedor_nome = user['name'] if user['role'] == 'vendedor' else (body.get('usuario') or user['name'])

            if not reserva_cod or not hospede or not hotel:
                return self._send_json({'error': 'Número da reserva, hóspede e hotel são obrigatórios'}, 400)

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO reservations (
                    reserva_cod, hospede, data_criacao, checkin, checkout, 
                    valor, qtde_hospedes, hotel, usuario, user_id, qtde_diarias, empresa, baixa_almaz
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                reserva_cod, hospede, data_criacao, checkin, checkout,
                valor, qtde_hospedes, hotel, vendedor_nome, user['id'], qtde_diarias, empresa, baixa_almaz
            ))
            new_id = cursor.lastrowid
            conn.commit()
            conn.close()

            return self._send_json({'success': True, 'id': new_id, 'message': 'Lançamento efetuado com sucesso!'})

        # Criar Usuário (Admin)
        if path == '/api/users':
            if user['role'] != 'admin':
                return self._send_json({'error': 'Apenas administradores podem criar usuários'}, 403)

            name = str(body.get('name', '')).strip()
            username = str(body.get('username', '')).strip().lower()
            password = str(body.get('password', '')).strip()
            role = str(body.get('role', 'vendedor')).strip().lower()

            if not name or not username or not password:
                return self._send_json({'error': 'Nome, usuário e senha são obrigatórios'}, 400)
            if role not in ('admin', 'vendedor', 'analista'):
                return self._send_json({'error': 'Função inválida'}, 400)

            conn = get_db()
            cursor = conn.cursor()
            try:
                cursor.execute('''
                    INSERT INTO users (name, username, password_hash, role)
                    VALUES (?, ?, ?, ?)
                ''', (name, username, hash_password(password), role))
                new_id = cursor.lastrowid
                conn.commit()
                conn.close()
                return self._send_json({'success': True, 'id': new_id, 'message': 'Usuário cadastrado com sucesso!'})
            except sqlite3.IntegrityError:
                conn.close()
                return self._send_json({'error': 'Nome de usuário já existe'}, 400)

        self._send_json({'error': 'Endpoint não encontrado'}, 404)

    def handle_api_put(self, path):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'error': 'Não autenticado'}, 401)

        body = self._read_json_body()

        # Atualizar Reserva (Apenas Admin ou Vendedor Dono)
        if path.startswith('/api/reservations/'):
            res_id = path.split('/')[-1]
            if not res_id.isdigit():
                return self._send_json({'error': 'ID inválido'}, 400)

            if user['role'] not in ('admin', 'vendedor'):
                return self._send_json({'error': 'Analistas têm acesso apenas de visualização'}, 403)

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM reservations WHERE id = ?', (res_id,))
            current = cursor.fetchone()
            if not current:
                conn.close()
                return self._send_json({'error': 'Reserva não encontrada'}, 404)

            # Se for vendedor, só pode editar se for a dele e se o admin permitir
            if user['role'] == 'vendedor' and current['user_id'] != user['id']:
                conn.close()
                return self._send_json({'error': 'Você só pode alterar seus próprios lançamentos'}, 403)

            reserva_cod = body.get('reserva_cod', current['reserva_cod'])
            hospede = body.get('hospede', current['hospede'])
            data_criacao = body.get('data_criacao', current['data_criacao'])
            checkin = body.get('checkin', current['checkin'])
            checkout = body.get('checkout', current['checkout'])
            valor = float(body.get('valor', current['valor']))
            qtde_hospedes = int(body.get('qtde_hospedes', current['qtde_hospedes']))
            hotel = body.get('hotel', current['hotel'])
            qtde_diarias = int(body.get('qtde_diarias', current['qtde_diarias']))
            empresa = body.get('empresa', current['empresa'])
            baixa_almaz = body.get('baixa_almaz', current['baixa_almaz'])
            usuario = body.get('usuario', current['usuario']) if user['role'] == 'admin' else current['usuario']

            cursor.execute('''
                UPDATE reservations SET
                    reserva_cod = ?, hospede = ?, data_criacao = ?, checkin = ?, checkout = ?,
                    valor = ?, qtde_hospedes = ?, hotel = ?, usuario = ?, qtde_diarias = ?,
                    empresa = ?, baixa_almaz = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (
                reserva_cod, hospede, data_criacao, checkin, checkout,
                valor, qtde_hospedes, hotel, usuario, qtde_diarias,
                empresa, baixa_almaz, res_id
            ))
            conn.commit()
            conn.close()
            return self._send_json({'success': True, 'message': 'Lançamento atualizado com sucesso!'})

        # Atualizar Usuário (Admin)
        if path.startswith('/api/users/'):
            if user['role'] != 'admin':
                return self._send_json({'error': 'Acesso exclusivo de administrador'}, 403)

            u_id = path.split('/')[-1]
            name = body.get('name')
            role = body.get('role')
            active = body.get('active')
            password = body.get('password')

            conn = get_db()
            cursor = conn.cursor()
            
            if password:
                cursor.execute('''
                    UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), 
                    active = COALESCE(?, active), password_hash = ? WHERE id = ?
                ''', (name, role, active, hash_password(password), u_id))
            else:
                cursor.execute('''
                    UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), 
                    active = COALESCE(?, active) WHERE id = ?
                ''', (name, role, active, u_id))

            conn.commit()
            conn.close()
            return self._send_json({'success': True, 'message': 'Usuário atualizado com sucesso!'})

        self._send_json({'error': 'Endpoint não encontrado'}, 404)

    def handle_api_delete(self, path):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'error': 'Não autenticado'}, 401)

        # Excluir Reserva (Apenas Administrador)
        if path.startswith('/api/reservations/'):
            if user['role'] != 'admin':
                return self._send_json({'error': 'Apenas administradores podem excluir registros do sistema'}, 403)

            res_id = path.split('/')[-1]
            conn = get_db()
            conn.execute('DELETE FROM reservations WHERE id = ?', (res_id,))
            conn.commit()
            conn.close()
            return self._send_json({'success': True, 'message': 'Reserva removida com sucesso!'})

        # Excluir Usuário (Apenas Administrador)
        if path.startswith('/api/users/'):
            if user['role'] != 'admin':
                return self._send_json({'error': 'Apenas administradores podem gerenciar usuários'}, 403)

            u_id = path.split('/')[-1]
            if str(user['id']) == str(u_id):
                return self._send_json({'error': 'Você não pode excluir sua própria conta de administrador'}, 400)

            conn = get_db()
            conn.execute('DELETE FROM users WHERE id = ?', (u_id,))
            conn.commit()
            conn.close()
            return self._send_json({'success': True, 'message': 'Usuário removido!'})

        self._send_json({'error': 'Endpoint não encontrado'}, 404)

def run():
    init_db()
    server_address = ('0.0.0.0', PORT)
    httpd = HTTPServer(server_address, AceiteRequestHandler)
    print(f"=====================================================")
    print(f"✨ ACEITE HOSPEDAGEM - SERVIDOR INICIADO NA PORTA {PORT}")
    print(f"🌐 Acesse: http://localhost:{PORT}")
    print(f"=====================================================")
    httpd.serve_forever()

if __name__ == '__main__':
    run()
