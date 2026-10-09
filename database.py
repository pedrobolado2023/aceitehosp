import os
import json
import sqlite3
import hashlib
import hmac
import secrets
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

DB_FILE = os.path.join(os.path.dirname(__file__), "aceite_hospedagem.db")

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    hashed = hashlib.sha256((salt + password).encode('utf-8')).hexdigest()
    return f"{salt}${hashed}"

def verify_password(stored_hash: str, password: str) -> bool:
    try:
        salt, h = stored_hash.split('$')
        computed = hashlib.sha256((salt + password).encode('utf-8')).hexdigest()
        return hmac.compare_digest(h, computed)
    except Exception:
        return False

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # Tabela de Usuários
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'vendedor', 'analista')),
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
    ''')

    # Tabela de Reservas / Lançamentos
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reserva_cod TEXT NOT NULL,
        hospede TEXT NOT NULL,
        data_criacao TEXT NOT NULL,
        checkin TEXT NOT NULL,
        checkout TEXT NOT NULL,
        valor REAL NOT NULL,
        qtde_hospedes INTEGER NOT NULL,
        hotel TEXT NOT NULL,
        usuario TEXT NOT NULL,
        user_id INTEGER,
        qtde_diarias INTEGER NOT NULL,
        empresa TEXT NOT NULL,
        baixa_almaz TEXT DEFAULT '',
        status TEXT DEFAULT 'Confirmada',
        observacoes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
    ''')

    # Tabela de Sessões (Tokens de Autenticação em memória/banco)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        username TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
    ''')

    # Usuários padrões iniciais caso não existam
    cursor.execute('SELECT COUNT(*) FROM users')
    if cursor.fetchone()[0] == 0:
        default_users = [
            ("Administrador Geral", "admin", hash_password("admin123"), "admin"),
            ("Maria Clara", "mariaclara", hash_password("vendas123"), "vendedor"),
            ("Carlos Vendas", "carlos", hash_password("vendas123"), "vendedor"),
            ("Analista de Performance", "analista", hash_password("analista123"), "analista")
        ]
        cursor.executemany(
            'INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)',
            default_users
        )
        conn.commit()

        # Inserir alguns lançamentos da imagem para iniciar a experiência completa e realista
        seed_reservations = [
            ("2042199", "Franciely Clementino Liberato Comini", "2026-10-05", "2026-11-05", "2026-11-08", 2382.01, 5, "Solar das Águas", "Maria Clara", 2, 3, "Olímpia", "Baixado"),
            ("2042256", "Alexandre william Rodrigues wernz", "2026-10-05", "2026-10-07", "2026-10-10", 1887.87, 3, "Solar das Águas", "Maria Clara", 2, 3, "Sunny", "Baixado"),
            ("2042145", "EVERTON RODRIGUES SAMPAIO", "2026-10-06", "2026-11-06", "2026-11-08", 2146.18, 5, "Olímpia Park", "Maria Clara", 2, 2, "Sunny", "Baixado"),
            ("2042249", "Leonardo Gois Peixoto", "2026-10-06", "2026-10-18", "2026-10-21", 1826.22, 5, "Solar das Águas", "Maria Clara", 2, 3, "Solar", "Pendente"),
            ("2042333", "Osvaldo Carlos Belvedere", "2026-10-06", "2026-10-16", "2026-10-18", 1944.97, 5, "Olímpia Park", "Maria Clara", 2, 2, "Sunny", "Baixado"),
            ("2042224", "Claudia Leandro da Silva Neves", "2026-10-06", "2026-12-02", "2026-12-05", 1407.70, 3, "Solar das Águas", "Maria Clara", 2, 3, "Sunny", "Baixado"),
            ("2042316", "Almir Marques Oliva", "2026-10-06", "2026-10-16", "2026-10-19", 1571.00, 2, "Solar das Águas", "Maria Clara", 2, 3, "Ômega", "Pendente"),
            ("2042157", "Mayara Fernanda Cardoso da Silva", "2026-10-06", "2027-04-07", "2027-04-11", 2228.84, 5, "Olímpia Park", "Maria Clara", 2, 4, "Olímpia", "Baixado"),
            ("2042313", "Eduardo Lima Pinheiro", "2026-10-06", "2027-01-04", "2027-01-08", 2748.78, 5, "Solar das Águas", "Maria Clara", 2, 4, "Solar", "Baixado"),
            ("2042314", "Eduardo Lima Pinheiro", "2026-10-06", "2027-01-04", "2027-01-08", 3086.10, 4, "Solar das Águas", "Maria Clara", 2, 4, "Solar", "Pendente"),
            ("2042274", "Ana Caroline da Silva Soares", "2026-10-08", "2026-12-28", "2026-12-30", 1391.42, 3, "Solar das Águas", "Maria Clara", 2, 2, "Sunny", "Baixado"),
            ("2042326", "anne maria fernandes", "2026-10-08", "2027-01-11", "2027-01-14", 2959.74, 4, "Solar das Águas", "Maria Clara", 2, 3, "Solar", "Baixado"),
            ("2042325", "anne maria fernandes", "2026-10-08", "2027-01-11", "2027-01-14", 3615.84, 5, "Solar das Águas", "Maria Clara", 2, 3, "Solar", "Baixado"),
            ("2042350", "Juan Carlos de Souza Silva", "2026-10-08", "2026-10-20", "2026-10-22", 1047.33, 4, "Solar das Águas", "Maria Clara", 2, 2, "Solar", "Pendente")
        ]
        cursor.executemany('''
            INSERT INTO reservations (
                reserva_cod, hospede, data_criacao, checkin, checkout, 
                valor, qtde_hospedes, hotel, usuario, user_id, qtde_diarias, empresa, baixa_almaz
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', seed_reservations)
        conn.commit()

    conn.close()

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn
