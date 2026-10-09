// ================= ESTADO GLOBAL DA APLICAÇÃO =================
const AppState = {
  currentUser: null,
  token: localStorage.getItem('aceite_token') || '',
  activeTab: 'reservations',
  reservations: [],
  metrics: null,
  users: [],
  options: {
    hotels: [],
    empresas: [],
    sellers: []
  },
  charts: {}
};

// ================= UTILITÁRIOS =================
function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function formatDateBR(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

async function apiRequest(endpoint, method = 'GET', data = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (AppState.token) {
    headers['Authorization'] = `Bearer ${AppState.token}`;
  }

  const options = { method, headers };
  if (data && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(data);
  }

  try {
    const res = await fetch(`/api${endpoint}`, options);
    const result = await res.json();
    if (!res.ok) {
      if (res.status === 401 && AppState.token) {
        logout();
      }
      throw new Error(result.error || 'Erro na requisição');
    }
    return result;
  } catch (err) {
    throw err;
  }
}

// ================= AUTENTICAÇÃO =================
async function checkAuth() {
  if (!AppState.token) {
    showLoginView(true);
    return;
  }

  try {
    const data = await apiRequest('/auth/me');
    if (data.authenticated) {
      AppState.currentUser = data.user;
      showLoginView(false);
      setupUIForRole(data.user);
      await loadInitialData();
    } else {
      logout();
    }
  } catch (err) {
    logout();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('login-username').value;
  const passwordInput = document.getElementById('login-password').value;
  const errorBox = document.getElementById('login-error');
  errorBox.style.display = 'none';

  try {
    const res = await apiRequest('/auth/login', 'POST', {
      username: usernameInput,
      password: passwordInput
    });
    AppState.token = res.token;
    localStorage.setItem('aceite_token', res.token);
    AppState.currentUser = res.user;
    showToast(`Bem-vindo(a), ${res.user.name}!`, 'success');
    showLoginView(false);
    setupUIForRole(res.user);
    await loadInitialData();
  } catch (err) {
    errorBox.innerText = err.message;
    errorBox.style.display = 'block';
  }
}

function fillLoginCredentials(username, password) {
  document.getElementById('login-username').value = username;
  document.getElementById('login-password').value = password;
}

function logout() {
  if (AppState.token) {
    apiRequest('/auth/logout', 'POST').catch(() => {});
  }
  AppState.token = '';
  AppState.currentUser = null;
  localStorage.removeItem('aceite_token');
  showLoginView(true);
}

function showLoginView(show) {
  const loginOverlay = document.getElementById('login-screen');
  const appContainer = document.getElementById('app-container');
  if (show) {
    loginOverlay.style.display = 'flex';
    appContainer.style.display = 'none';
  } else {
    loginOverlay.style.display = 'none';
    appContainer.style.display = 'flex';
  }
}

function setupUIForRole(user) {
  document.getElementById('header-user-name').innerText = user.name;
  document.getElementById('header-user-role').innerText = user.role.toUpperCase();
  document.getElementById('header-avatar-initial').innerText = user.name.charAt(0).toUpperCase();

  // Permissões de navegação e botões
  const btnNewRes = document.getElementById('btn-new-reservation');
  const navUsers = document.getElementById('nav-item-users');

  if (user.role === 'analista') {
    if (btnNewRes) btnNewRes.style.display = 'none';
    if (navUsers) navUsers.style.display = 'none';
  } else if (user.role === 'vendedor') {
    if (btnNewRes) btnNewRes.style.display = 'inline-flex';
    if (navUsers) navUsers.style.display = 'none';
  } else if (user.role === 'admin') {
    if (btnNewRes) btnNewRes.style.display = 'inline-flex';
    if (navUsers) navUsers.style.display = 'flex';
  }

  // Se o analista logar, podemos direcionar direto para o Dashboard
  if (user.role === 'analista') {
    switchTab('dashboard');
  } else {
    switchTab('reservations');
  }
}

// ================= CARREGAMENTO DE DADOS =================
async function loadInitialData() {
  try {
    const opts = await apiRequest('/form-options');
    AppState.options = opts;
    populateSelectOptions();
    await loadReservations();
    if (AppState.activeTab === 'dashboard') {
      await loadDashboardMetrics();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function populateSelectOptions() {
  // Filtros
  const filterHotel = document.getElementById('filter-hotel');
  const filterEmpresa = document.getElementById('filter-empresa');
  
  // Modal de Reserva
  const modalHotel = document.getElementById('res-hotel');
  const modalEmpresa = document.getElementById('res-empresa');

  if (filterHotel) {
    filterHotel.innerHTML = '<option value="">Todos os Hotéis</option>' + 
      AppState.options.hotels.map(h => `<option value="${h}">${h}</option>`).join('');
  }

  if (filterEmpresa) {
    filterEmpresa.innerHTML = '<option value="">Todas as Empresas</option>' + 
      AppState.options.empresas.map(e => `<option value="${e}">${e}</option>`).join('');
  }

  if (modalHotel) {
    modalHotel.innerHTML = '<option value="">Selecione o hotel...</option>' + 
      AppState.options.hotels.map(h => `<option value="${h}">${h}</option>`).join('');
  }

  if (modalEmpresa) {
    modalEmpresa.innerHTML = '<option value="">Selecione a empresa...</option>' + 
      AppState.options.empresas.map(e => `<option value="${e}">${e}</option>`).join('');
  }
}

// ================= LISTAGEM DE RESERVAS =================
async function loadReservations() {
  const search = document.getElementById('filter-search')?.value || '';
  const hotel = document.getElementById('filter-hotel')?.value || '';
  const empresa = document.getElementById('filter-empresa')?.value || '';
  const baixa = document.getElementById('filter-baixa')?.value || '';
  const startDate = document.getElementById('filter-start-date')?.value || '';
  const endDate = document.getElementById('filter-end-date')?.value || '';

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (hotel) params.append('hotel', hotel);
  if (empresa) params.append('empresa', empresa);
  if (baixa) params.append('baixa_almaz', baixa);
  if (startDate) params.append('start_date', startDate);
  if (endDate) params.append('end_date', endDate);

  try {
    const res = await apiRequest(`/reservations?${params.toString()}`);
    AppState.reservations = res.reservations;
    renderReservationsTable();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderReservationsTable() {
  const tbody = document.getElementById('reservations-tbody');
  const countBadge = document.getElementById('table-count-badge');
  const sumBadge = document.getElementById('table-sum-badge');
  
  if (!tbody) return;

  tbody.innerHTML = '';
  let totalSoma = 0;

  if (AppState.reservations.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; padding: 2rem; color: #94a3b8;">Nenhum lançamento encontrado para os filtros selecionados.</td></tr>`;
    if (countBadge) countBadge.innerText = '0 reservas';
    if (sumBadge) sumBadge.innerText = 'R$ 0,00';
    return;
  }

  AppState.reservations.forEach(r => {
    totalSoma += Number(r.valor || 0);
    const tr = document.createElement('tr');

    // Badge styling
    let hotelClass = 'badge-hotel-default';
    if (r.hotel.includes('Solar')) hotelClass = 'badge-hotel-solar';
    else if (r.hotel.includes('Olímpia') || r.hotel.includes('Olimpia')) hotelClass = 'badge-hotel-olimpia';

    let empClass = 'badge-emp-solar';
    if (r.empresa.includes('Olímpia') || r.empresa.includes('Olimpia')) empClass = 'badge-emp-olimpia';
    else if (r.empresa.includes('Sunny')) empClass = 'badge-emp-sunny';
    else if (r.empresa.includes('Ômega') || r.empresa.includes('Omega')) empClass = 'badge-emp-omega';

    const baixaClass = r.baixa_almaz === 'Baixado' ? 'badge-status-baixado' : 'badge-status-pendente';

    // Ações permitidas
    const canEdit = AppState.currentUser.role === 'admin' || (AppState.currentUser.role === 'vendedor' && r.user_id === AppState.currentUser.id);
    const canDelete = AppState.currentUser.role === 'admin';

    tr.innerHTML = `
      <td style="font-weight: 700; color: #1e293b;">#${r.reserva_cod}</td>
      <td style="font-weight: 600;">${r.hospede}</td>
      <td>${formatDateBR(r.data_criacao)}</td>
      <td>${formatDateBR(r.checkin)}</td>
      <td>${formatDateBR(r.checkout)}</td>
      <td style="font-weight: 700; color: #0f172a;">${formatMoney(r.valor)}</td>
      <td style="text-align: center;">${r.qtde_hospedes}</td>
      <td><span class="badge ${hotelClass}">${r.hotel}</span></td>
      <td><span class="badge-user-pill">${r.usuario}</span></td>
      <td style="text-align: center;">${r.qtde_diarias}</td>
      <td><span class="badge ${empClass}">${r.empresa}</span></td>
      <td><span class="badge ${baixaClass}">${r.baixa_almaz || 'Pendente'}</span></td>
      <td style="text-align: right;">
        ${canEdit ? `<button class="btn btn-outline btn-sm" onclick="openEditModal(${r.id})" title="Editar"><svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>` : ''}
        ${canDelete ? `<button class="btn btn-danger-outline btn-sm" onclick="deleteReservation(${r.id})" title="Excluir"><svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (countBadge) countBadge.innerText = `${AppState.reservations.length} reservas`;
  if (sumBadge) sumBadge.innerText = formatMoney(totalSoma);
}

// ================= MODAL DE LANÇAMENTO / EDIÇÃO =================
function openNewModal() {
  document.getElementById('modal-reserva-title').innerText = 'Novo Lançamento de Reserva';
  document.getElementById('form-reserva').reset();
  document.getElementById('res-id').value = '';
  document.getElementById('res-data-criacao').value = new Date().toISOString().split('T')[0];
  
  // Se for admin, exibe campo de vendedor para atribuir
  const userFieldGroup = document.getElementById('group-res-usuario');
  if (AppState.currentUser.role === 'admin') {
    userFieldGroup.style.display = 'flex';
    const select = document.getElementById('res-usuario');
    select.innerHTML = AppState.options.sellers.map(s => `<option value="${s}">${s}</option>`).join('');
  } else {
    userFieldGroup.style.display = 'none';
  }

  document.getElementById('modal-reserva').classList.add('active');
}

function openEditModal(id) {
  const res = AppState.reservations.find(r => r.id === id);
  if (!res) return;

  document.getElementById('modal-reserva-title').innerText = `Editar Lançamento #${res.reserva_cod}`;
  document.getElementById('res-id').value = res.id;
  document.getElementById('res-cod').value = res.reserva_cod;
  document.getElementById('res-hospede').value = res.hospede;
  document.getElementById('res-data-criacao').value = res.data_criacao;
  document.getElementById('res-checkin').value = res.checkin;
  document.getElementById('res-checkout').value = res.checkout;
  document.getElementById('res-valor').value = res.valor;
  document.getElementById('res-hospedes').value = res.qtde_hospedes;
  document.getElementById('res-hotel').value = res.hotel;
  document.getElementById('res-diarias').value = res.qtde_diarias;
  document.getElementById('res-empresa').value = res.empresa;
  document.getElementById('res-baixa').value = res.baixa_almaz;

  const userFieldGroup = document.getElementById('group-res-usuario');
  if (AppState.currentUser.role === 'admin') {
    userFieldGroup.style.display = 'flex';
    const select = document.getElementById('res-usuario');
    select.innerHTML = AppState.options.sellers.map(s => `<option value="${s}" ${s === res.usuario ? 'selected' : ''}>${s}</option>`).join('');
  } else {
    userFieldGroup.style.display = 'none';
  }

  document.getElementById('modal-reserva').classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

// Cálculo automático de diárias com base em checkin e checkout
function autoCalculateDiarias() {
  const checkinVal = document.getElementById('res-checkin').value;
  const checkoutVal = document.getElementById('res-checkout').value;
  if (checkinVal && checkoutVal) {
    const d1 = new Date(checkinVal);
    const d2 = new Date(checkoutVal);
    const diffTime = d2.getTime() - d1.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays > 0) {
      document.getElementById('res-diarias').value = diffDays;
    }
  }
}

async function handleSaveReservation(e) {
  e.preventDefault();
  const id = document.getElementById('res-id').value;
  const payload = {
    reserva_cod: document.getElementById('res-cod').value,
    hospede: document.getElementById('res-hospede').value,
    data_criacao: document.getElementById('res-data-criacao').value,
    checkin: document.getElementById('res-checkin').value,
    checkout: document.getElementById('res-checkout').value,
    valor: parseFloat(document.getElementById('res-valor').value),
    qtde_hospedes: parseInt(document.getElementById('res-hospedes').value),
    hotel: document.getElementById('res-hotel').value,
    qtde_diarias: parseInt(document.getElementById('res-diarias').value),
    empresa: document.getElementById('res-empresa').value,
    baixa_almaz: document.getElementById('res-baixa').value
  };

  if (AppState.currentUser.role === 'admin') {
    payload.usuario = document.getElementById('res-usuario').value;
  }

  try {
    if (id) {
      await apiRequest(`/reservations/${id}`, 'PUT', payload);
      showToast('Lançamento atualizado com sucesso!', 'success');
    } else {
      await apiRequest('/reservations', 'POST', payload);
      showToast('Reserva lançada com sucesso no sistema!', 'success');
    }
    closeModal('modal-reserva');
    await loadReservations();
    if (AppState.activeTab === 'dashboard') {
      await loadDashboardMetrics();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteReservation(id) {
  if (!confirm('Tem certeza que deseja excluir esta reserva permanentemente?')) return;
  try {
    await apiRequest(`/reservations/${id}`, 'DELETE');
    showToast('Lançamento excluído com sucesso.', 'success');
    await loadReservations();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ================= DASHBOARD & ANALYTICS =================
async function loadDashboardMetrics() {
  const startDate = document.getElementById('dash-start-date')?.value || '';
  const endDate = document.getElementById('dash-end-date')?.value || '';
  const params = new URLSearchParams();
  if (startDate) params.append('start_date', startDate);
  if (endDate) params.append('end_date', endDate);

  try {
    const data = await apiRequest(`/dashboard/metrics?${params.toString()}`);
    AppState.metrics = data;
    renderKPIs(data.general);
    renderCharts(data);
    renderRankings(data);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderKPIs(gen) {
  document.getElementById('kpi-total-vendas').innerText = formatMoney(gen.total_faturamento);
  document.getElementById('kpi-qtde-reservas').innerText = gen.total_reservas;
  document.getElementById('kpi-ticket-medio').innerText = formatMoney(gen.ticket_medio);
  document.getElementById('kpi-total-diarias').innerText = `${gen.total_diarias} diárias (${gen.total_hospedes} hóspedes)`;
}

function renderCharts(data) {
  // Destruir gráficos anteriores se existirem
  if (AppState.charts.salesTime) AppState.charts.salesTime.destroy();
  if (AppState.charts.hotelShare) AppState.charts.hotelShare.destroy();
  if (AppState.charts.sellerShare) AppState.charts.sellerShare.destroy();
  if (AppState.charts.companyShare) AppState.charts.companyShare.destroy();

  // 1. Gráfico de Evolução (Dia / Mês)
  const ctxTime = document.getElementById('chart-evolution').getContext('2d');
  const labelsTime = data.by_day.map(d => formatDateBR(d.data));
  const valuesTime = data.by_day.map(d => d.total);

  AppState.charts.salesTime = new Chart(ctxTime, {
    type: 'line',
    data: {
      labels: labelsTime,
      datasets: [{
        label: 'Faturamento (R$)',
        data: valuesTime,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.08)',
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointBackgroundColor: '#2563eb',
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` Faturamento: ${formatMoney(ctx.raw)}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: '#f1f5f9' },
          ticks: {
            callback: (v) => 'R$ ' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v)
          }
        },
        x: {
          grid: { display: false }
        }
      }
    }
  });

  // 2. Gráfico por Hotel
  const ctxHotel = document.getElementById('chart-hotel').getContext('2d');
  AppState.charts.hotelShare = new Chart(ctxHotel, {
    type: 'doughnut',
    data: {
      labels: data.by_hotel.map(h => h.hotel),
      datasets: [{
        data: data.by_hotel.map(h => h.total),
        backgroundColor: ['#2563eb', '#f59e0b', '#10b981', '#8b5cf6', '#0284c7'],
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${formatMoney(ctx.raw)}`
          }
        }
      },
      cutout: '68%'
    }
  });

  // 3. Gráfico por Vendedor
  const ctxSeller = document.getElementById('chart-seller').getContext('2d');
  AppState.charts.sellerShare = new Chart(ctxSeller, {
    type: 'bar',
    data: {
      labels: data.by_seller.map(s => s.usuario),
      datasets: [{
        label: 'Vendas (R$)',
        data: data.by_seller.map(s => s.total),
        backgroundColor: '#0284c7',
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` Total: ${formatMoney(ctx.raw)}`
          }
        }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
        x: { grid: { display: false } }
      }
    }
  });

  // 4. Gráfico por Empresa
  const ctxCompany = document.getElementById('chart-company').getContext('2d');
  AppState.charts.companyShare = new Chart(ctxCompany, {
    type: 'pie',
    data: {
      labels: data.by_company.map(c => c.empresa),
      datasets: [{
        data: data.by_company.map(c => c.total),
        backgroundColor: ['#f97316', '#eab308', '#38bdf8', '#22c55e', '#64748b']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${formatMoney(ctx.raw)}`
          }
        }
      }
    }
  });
}

function renderRankings(data) {
  // Lista de Ranking de Vendedores
  const sellerList = document.getElementById('seller-ranking-list');
  if (sellerList) {
    sellerList.innerHTML = data.by_seller.map((s, idx) => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--border-subtle);">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-weight: 800; color: #94a3b8; font-size: 0.85rem; width: 20px;">#${idx + 1}</span>
          <span style="font-weight: 600; font-size: 0.9rem;">${s.usuario}</span>
        </div>
        <div style="text-align: right;">
          <div style="font-weight: 700; color: #0f172a; font-size: 0.9rem;">${formatMoney(s.total)}</div>
          <div style="font-size: 0.75rem; color: #64748b;">${s.qtd} vendas</div>
        </div>
      </div>
    `).join('');
  }

  // Tabela Comparativa Mensal e Anual
  const periodTable = document.getElementById('period-summary-tbody');
  if (periodTable) {
    periodTable.innerHTML = data.by_month.map(m => `
      <tr>
        <td style="font-weight: 600;">${m.mes}</td>
        <td>${m.qtd} reservas</td>
        <td style="font-weight: 700; color: #2563eb;">${formatMoney(m.total)}</td>
      </tr>
    `).join('');
  }
}

// ================= GESTÃO DE USUÁRIOS (ADMIN) =================
async function loadUsers() {
  try {
    const res = await apiRequest('/users');
    AppState.users = res.users;
    renderUsersTable();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderUsersTable() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  AppState.users.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 700;">#${u.id}</td>
      <td style="font-weight: 600;">${u.name}</td>
      <td><code>@${u.username}</code></td>
      <td>
        <span class="badge" style="background: ${u.role === 'admin' ? '#eff6ff; color: #2563eb;' : u.role === 'vendedor' ? '#fef3c7; color: #92400e;' : '#ecfdf5; color: #15803d;'}">
          ${u.role.toUpperCase()}
        </span>
      </td>
      <td>
        <span class="badge ${u.active ? 'badge-status-baixado' : 'badge-danger-outline'}">
          ${u.active ? 'Ativo' : 'Inativo'}
        </span>
      </td>
      <td>${formatDateBR(u.created_at.split(' ')[0])}</td>
      <td style="text-align: right;">
        <button class="btn btn-outline btn-sm" onclick="openEditUserModal(${u.id})">Editar</button>
        ${u.id !== AppState.currentUser.id ? `<button class="btn btn-danger-outline btn-sm" onclick="deleteUser(${u.id})">Remover</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openNewUserModal() {
  document.getElementById('modal-user-title').innerText = 'Cadastrar Novo Usuário';
  document.getElementById('form-user').reset();
  document.getElementById('user-id').value = '';
  document.getElementById('user-username').disabled = false;
  document.getElementById('modal-user').classList.add('active');
}

function openEditUserModal(id) {
  const user = AppState.users.find(u => u.id === id);
  if (!user) return;
  document.getElementById('modal-user-title').innerText = `Editar Usuário: ${user.name}`;
  document.getElementById('user-id').value = user.id;
  document.getElementById('user-name').value = user.name;
  document.getElementById('user-username').value = user.username;
  document.getElementById('user-username').disabled = true;
  document.getElementById('user-role').value = user.role;
  document.getElementById('user-password').value = '';
  document.getElementById('modal-user').classList.add('active');
}

async function handleSaveUser(e) {
  e.preventDefault();
  const id = document.getElementById('user-id').value;
  const payload = {
    name: document.getElementById('user-name').value,
    role: document.getElementById('user-role').value
  };

  const pass = document.getElementById('user-password').value;
  if (pass) payload.password = pass;

  try {
    if (id) {
      await apiRequest(`/users/${id}`, 'PUT', payload);
      showToast('Usuário atualizado com sucesso!', 'success');
    } else {
      payload.username = document.getElementById('user-username').value;
      if (!pass) throw new Error('A senha é obrigatória para novos usuários');
      await apiRequest('/users', 'POST', payload);
      showToast('Usuário cadastrado com sucesso!', 'success');
    }
    closeModal('modal-user');
    await loadUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteUser(id) {
  if (!confirm('Deseja realmente remover este usuário do sistema?')) return;
  try {
    await apiRequest(`/users/${id}`, 'DELETE');
    showToast('Usuário removido!', 'success');
    await loadUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ================= CONTROLE DE ABAS =================
function switchTab(tabId) {
  AppState.activeTab = tabId;

  // Atualizar visual do menu lateral
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.tab === tabId);
  });

  // Atualizar seções
  document.querySelectorAll('.tab-section').forEach(sec => {
    sec.style.display = 'none';
  });

  const activeSection = document.getElementById(`section-${tabId}`);
  if (activeSection) {
    activeSection.style.display = 'block';
  }

  // Ações ao trocar de aba
  if (tabId === 'dashboard') {
    document.getElementById('page-header-title').innerText = 'Dashboard Analítico de Vendas';
    document.getElementById('page-header-desc').innerText = 'Métricas consolidadas por hotel, vendedor, empresa e faturamento diário/mensal/anual.';
    loadDashboardMetrics();
  } else if (tabId === 'reservations') {
    document.getElementById('page-header-title').innerText = 'Lançamento de Reservas';
    document.getElementById('page-header-desc').innerText = 'Controle detalhado de reservas hoteleiras, hospedagens e confirmações.';
    loadReservations();
  } else if (tabId === 'users') {
    document.getElementById('page-header-title').innerText = 'Gestão de Usuários e Permissões';
    document.getElementById('page-header-desc').innerText = 'Criação e administração de vendedores, analistas e administradores do sistema.';
    loadUsers();
  }
}

// ================= INICIALIZAÇÃO =================
window.addEventListener('DOMContentLoaded', () => {
  // Listeners de login
  document.getElementById('login-form').addEventListener('submit', handleLogin);

  // Navegação
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(link.dataset.tab);
    });
  });

  // Formulário Reserva
  document.getElementById('form-reserva').addEventListener('submit', handleSaveReservation);
  document.getElementById('res-checkin').addEventListener('change', autoCalculateDiarias);
  document.getElementById('res-checkout').addEventListener('change', autoCalculateDiarias);

  // Formulário Usuário
  document.getElementById('form-user').addEventListener('submit', handleSaveUser);

  // Filtros de Reservas com debounce
  const filterInputs = ['filter-search', 'filter-hotel', 'filter-empresa', 'filter-baixa', 'filter-start-date', 'filter-end-date'];
  filterInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => loadReservations());
      el.addEventListener('change', () => loadReservations());
    }
  });

  // Checar sessão ativa
  checkAuth();
});
