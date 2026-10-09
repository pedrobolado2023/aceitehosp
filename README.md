# 🏨 Aceite Hospedagem - Plataforma de Gestão e Lançamento de Reservas

Uma solução robusta, moderna e elegante desenvolvida especificamente para a gestão hoteleira, controle de vendas e análise estratégica de desempenho.

---

## 🌟 Funcionalidades Principais

### 1. Níveis de Acesso e Departamentos (RBAC)
- 👑 **Administrador (`admin`)**:
  - Acesso total à plataforma.
  - Criação, edição e remoção de novos usuários (Vendedores, Analistas e Administradores).
  - Gestão e correção de todos os lançamentos de reservas existentes.
  - Acesso irrestrito a todos os relatórios e métricas de vendas.
- 💼 **Vendedor (`vendedor`)**:
  - Tela dedicada para lançamento ágil de reservas com os campos idênticos à planilha.
  - Cálculo automático de diárias com base no check-in e check-out.
  - Acompanhamento dos seus lançamentos com busca e filtros rápidos.
- 📊 **Analista de Vendas (`analista`)**:
  - Acesso exclusivo de visualização e inteligência de negócios.
  - **Bloqueio de escrita**: Não consegue criar, alterar ou excluir lançamentos.
  - Acesso direto ao **Dashboard Analítico** com métricas completas por dia, mês, ano, hotel, vendedor e empresa parceira.

---

### 2. Estrutura de Campos dos Lançamentos (Conforme Imagem)
- **Cód. Reserva**: Código localizador hoteleiro (ex: `2042199`).
- **Hóspede**: Nome completo do hóspede titular.
- **Data de Criação**: Data em que a reserva foi concretizada.
- **Check-in / Check-out**: Datas de entrada e saída.
- **Valor Total (R$)**: Faturamento da reserva.
- **Qtde Hóspedes**: Total de pessoas na hospedagem.
- **Hotel**: Hotéis cadastrados com badges e cores dedicadas (*Solar das Águas*, *Olímpia Park*, etc.).
- **Usuário / Vendedor**: Identificação de quem gerou a venda.
- **Qtde Diárias**: Diárias calculadas automaticamente pelo sistema.
- **Empresa**: Parceira de comercialização (*Olímpia*, *Sunny*, *Solar*, *Ômega*).
- **Baixa Almaz**: Status de liquidação (*Baixado* / *Pendente*).

---

### 3. Dashboard Executivo & Analytics
- **KPIs em Tempo Real**:
  - Faturamento Total Acumulado (R$).
  - Quantidade de Vendas Realizadas.
  - Ticket Médio por Venda.
  - Total de Diárias e Hóspedes Atendidos.
- **Gráficos Interativos (Chart.js)**:
  - 📈 Evolução do Faturamento por Período (dia a dia).
  - 🍩 Distribuição de Vendas por Hotel.
  - 📊 Performance Financeira por Vendedor (*Quem Vendeu*).
  - 🥧 Participação de Mercado por Empresa Comercializadora.
  - 🏆 Ranking de Produtividade dos Vendedores e Resumo Mensal.

---

## 🚀 Como Executar

O sistema foi concebido utilizando **Python nativo e SQLite**, garantindo portabilidade absoluta e zero dependências externas no backend.

```bash
# Iniciar o servidor
python3 server.py
```

Acesse no seu navegador: **`http://localhost:8080`**

### 🔑 Credenciais Pré-configuradas para Testes
| Perfil | Usuário | Senha | Permissões |
| :--- | :--- | :--- | :--- |
| **Administrador** | `admin` | `admin123` | Controle total e gestão de usuários |
| **Vendedora** | `mariaclara` | `vendas123` | Lançamento e edição de reservas |
| **Analista** | `analista` | `analista123` | Dashboard e visualização analítica |
