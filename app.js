'use strict';
 
// ---------------------------------------------------------------------------
// 1. Configuración y Estado Global
// ---------------------------------------------------------------------------
const API_BASE = 'http://localhost:3000';
 
let _usuario = null;
let _token   = null;
 
// ---------------------------------------------------------------------------
// 2. HTTP Helper
// ---------------------------------------------------------------------------
 
async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('mg_token');
 
  try {
    const res = await fetch(API_BASE + url, {
      mode: 'cors',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...options.headers,
      },
    });
 
    if (res.status === 401) {
      const esValidacionInicial = url === '/api/auth/me' && !_usuario;
      if (!esValidacionInicial) {
        mostrarTostada('Sesión expirada. Volvé a ingresar.', 'warning');
        logout();
      }
      return null;
    }
 
    if (res.status === 204) return null;
 
    const data = await res.json();
 
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || 'Error ' + res.status;
      mostrarTostada(msg, 'danger');
      return null;
    }
 
    return data;
 
  } catch (err) {
    console.error('[API] Error de red:', err);
    if (err instanceof TypeError) {
      mostrarTostada(
        'No se pudo conectar con el servidor. Verificá que el backend esté corriendo en ' + API_BASE,
        'danger'
      );
    } else {
      mostrarTostada('Sin conexión con el servidor.', 'danger');
    }
    return null;
  }
}
 
// ---------------------------------------------------------------------------
// 3. Autenticación y Control de Acceso
// ---------------------------------------------------------------------------
 
async function iniciarApp() {
  const tokenGuardado = localStorage.getItem('mg_token');
 
  if (tokenGuardado) {
    _token = tokenGuardado;
    const response = await apiFetch('/api/auth/me');
 
    if (response && response.data) {
      _usuario = response.data;
      _onLoginExitoso(_usuario);
      return;
    }
 
    localStorage.removeItem('mg_token');
    localStorage.removeItem('mg_usuario');
    _token = null;
  }
 
  _mostrarPantallaLogin();
}
 
async function intentarLogin() {
  // El HTML usa id="login-email" y id="login-pass"
  const emailEl = (
    document.getElementById('login-email') ||
    document.getElementById('email') ||
    document.querySelector('input[type="email"]')
  );
 
  const passEl = (
    document.getElementById('login-pass') ||
    document.getElementById('login-password') ||
    document.getElementById('password') ||
    document.querySelector('input[type="password"]')
  );
 
  const email    = emailEl ? emailEl.value.trim() : '';
  const password = passEl  ? passEl.value         : '';
 
  if (!email || !password) {
    mostrarTostada('Ingresá tu email y contraseña.', 'warning');
    return;
  }
 
  const btnLogin = (
    document.getElementById('btn-login') ||
    document.getElementById('login-btn') ||
    document.querySelector('button[onclick*="intentarLogin"]') ||
    document.querySelector('button[type="submit"]')
  );
  const textoOriginal = btnLogin ? btnLogin.textContent : '';
  if (btnLogin) {
    btnLogin.disabled = true;
    btnLogin.textContent = 'Ingresando...';
  }
 
  try {
    const response = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
 
    if (!response) return;
 
    // El backend devuelve: { data: { usuario, token, accessToken, refreshToken } }
    const token   = (response.data && (response.data.token || response.data.accessToken)) || response.token;
    const usuario = _extraerUsuario(response);
 
    if (!token || !usuario) {
      mostrarTostada('Respuesta inesperada del servidor. Revisá la consola.', 'danger');
      console.error('[Login] Estructura no reconocida:', response);
      return;
    }
 
    localStorage.setItem('mg_token',   token);
    localStorage.setItem('mg_usuario', JSON.stringify(usuario));
 
    _token   = token;
    _usuario = usuario;
 
    _onLoginExitoso(_usuario);
 
  } finally {
    if (btnLogin) {
      btnLogin.disabled = false;
      btnLogin.textContent = textoOriginal;
    }
  }
}
 
function logout() {
  localStorage.removeItem('mg_token');
  localStorage.removeItem('mg_usuario');
  _token   = null;
  _usuario = null;
 
  if (typeof desconectarWS === 'function') desconectarWS();
  _mostrarPantallaLogin();
}
 
// ---------------------------------------------------------------------------
// 4. Interfaz de Usuario (UI)
// ---------------------------------------------------------------------------
 
function _onLoginExitoso(usuario) {
  _inyectarUsuarioUI(usuario);
  _ocultarPantallaLogin();
 
  if (typeof conectarWS === 'function') {
    conectarWS(localStorage.getItem('mg_token'));
  }
  cargarTablero();
}
 
function _mostrarPantallaLogin() {
  var el = document.getElementById('pantalla-login');
  if (el) el.classList.remove('hidden');
  var app = document.getElementById('app-principal');
  if (app) app.classList.add('hidden');
}
 
function _ocultarPantallaLogin() {
  var el = document.getElementById('pantalla-login');
  if (el) el.classList.add('hidden');
  var app = document.getElementById('app-principal');
  if (app) app.classList.remove('hidden');
}
 
function _inyectarUsuarioUI(usuario) {
  var elNombre = document.getElementById('sidebar-usuario-nombre');
  var elRol    = document.getElementById('sidebar-usuario-rol');
 
  if (elNombre) elNombre.textContent = usuario.nombre_completo || usuario.nombre || usuario.name || '—';
  if (elRol)    elRol.textContent    = usuario.rol || usuario.role || '—';
 
  var rolNormalizado = (usuario.rol || usuario.role || '').toLowerCase().trim();
 
  var permisos = {
    admin:      ['tablero','pacientes','turnos','internacion','auditoria','configuracion'],
    medico:     ['tablero','pacientes','turnos'],
    enfermeria: ['tablero','pacientes','internacion'],
    recepcion:  ['tablero','turnos'],
  };
 
  var modulosVisibles = permisos[rolNormalizado] || [];
 
  document.querySelectorAll('[data-modulo]').forEach(function(el) {
    el.style.display = modulosVisibles.indexOf(el.dataset.modulo) >= 0 ? '' : 'none';
  });
}
 
// ---------------------------------------------------------------------------
// 5. Módulos de Datos
// ---------------------------------------------------------------------------
 
async function cargarTablero() {
  var promises = [apiFetch('/api/camas'), apiFetch('/api/turnos?fecha=hoy')];
  var results = await Promise.all(promises);
  var responseCamas   = results[0];
  var responseTurnos  = results[1];
 
  if (responseCamas) {
    var camas = responseCamas.data || responseCamas;
    if (Array.isArray(camas)) {
      _setText('metrica-camas-ocupadas', camas.filter(function(c){ return c.estado === 'ocupada'; }).length);
      _setText('metrica-camas-libres',   camas.filter(function(c){ return c.estado === 'libre'; }).length);
    }
  }
 
  if (responseTurnos) {
    var turnos = responseTurnos.data || responseTurnos;
    if (Array.isArray(turnos)) {
      _renderTurnosTablero(turnos.slice(0, 8));
    }
  }
}
 
function _renderTurnosTablero(turnos) {
  var contenedor = (
    document.getElementById('lista-turnos-tablero') ||
    document.getElementById('turnos-tablero') ||
    document.querySelector('[data-seccion="turnos"]')
  );
 
  if (!contenedor) return;
 
  if (!turnos || turnos.length === 0) {
    contenedor.innerHTML = '<p class="text-muted">Sin turnos para hoy.</p>';
    return;
  }
 
  contenedor.innerHTML = turnos.map(function(t) {
    return '<div class="turno-item">' +
      '<span class="turno-hora">'      + (t.hora || t.horario || '—')            + '</span>' +
      '<span class="turno-paciente">'  + (t.paciente || t.nombre_paciente || '—') + '</span>' +
      '<span class="turno-medico">'    + (t.medico || t.nombre_medico || '')       + '</span>' +
    '</div>';
  }).join('');
}
 
// ---------------------------------------------------------------------------
// 6. Helpers y Utilidades
// ---------------------------------------------------------------------------
 
function _extraerUsuario(response) {
  if (!response) return null;
 
  // { data: { usuario: {...} } }  ← estructura principal del backend
  if (response.data && response.data.usuario) return response.data.usuario;
 
  // { data: { id, nombre_completo, rol, ... } }
  if (response.data && (response.data.id || response.data.email)) return response.data;
 
  // { usuario: {...} }
  if (response.usuario) return response.usuario;
 
  // { user: {...} }
  if (response.user) return response.user;
 
  // response directo con id o email
  if (response.id || response.email) return response;
 
  return null;
}
 
function _setText(id, valor) {
  var el = document.getElementById(id);
  if (el) el.textContent = (valor !== undefined && valor !== null) ? valor : '—';
}
 
// Polyfill seguro para mostrarTostada
if (typeof window.mostrarTostada !== 'function') {
  window.mostrarTostada = function (texto, tipo) {
    tipo = tipo || 'info';
    console.log('[Toast ' + tipo + ']: ' + texto);
    var contenedorToast = document.getElementById('toast-container');
    if (contenedorToast) {
      var toast = document.createElement('div');
      toast.className = 'toast toast-' + tipo;
      toast.textContent = texto;
      contenedorToast.appendChild(toast);
      setTimeout(function(){ toast.parentNode && toast.parentNode.removeChild(toast); }, 4000);
    } else {
      alert(texto);
    }
  };
}
 
// Exponer al scope global
window.intentarLogin = intentarLogin;
window.logout        = logout;
window.cargarTablero = cargarTablero;
window.iniciarApp    = iniciarApp;
 
// Arrancar la app cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', iniciarApp);
 
// ---------------------------------------------------------------------------
// 7. Integración con el sistema de UI del HTML (entrarAlSistema)
// ---------------------------------------------------------------------------
// El HTML tiene su propio entrarAlSistema() que maneja el layout.
// Cuando el login real contra el backend tiene éxito, mapeamos los datos
// del usuario del backend al formato que espera entrarAlSistema.
 
var _onLoginExitosoOriginal = _onLoginExitoso;
 
window._onLoginExitosoBackend = function(usuarioBackend) {
  // Si el HTML ya define entrarAlSistema, lo usamos para mantener
  // la UI del sistema (permisos, sidebar, animaciones, etc.)
  if (typeof entrarAlSistema === 'function') {
    // Mapear campos del backend al formato del HTML
    var usuarioUI = {
      pass:       '',                                   // no se usa
      nombre:     usuarioBackend.nombre_completo || usuarioBackend.nombre || '—',
      iniciales:  usuarioBackend.avatar_iniciales || (usuarioBackend.nombre_completo || '').split(' ').slice(0,2).map(function(p){ return p[0] || ''; }).join('').toUpperCase(),
      rol:        (usuarioBackend.rol || 'medico').toLowerCase(),
      rolLabel:   { admin: 'Administrador', medico: 'Médico', enfermeria: 'Enfermería', recepcion: 'Recepción' }[(usuarioBackend.rol || '').toLowerCase()] || usuarioBackend.rol,
      turno:      usuarioBackend.turno || 'Turno Mañana',
    };
    entrarAlSistema(usuarioBackend.email, usuarioUI);
  } else {
    // Fallback: usar la lógica original del app.js
    _onLoginExitosoOriginal(usuarioBackend);
  }
};
 
// Redefinir intentarLogin para usar la integración completa
var _intentarLoginOriginal = intentarLogin;
window.intentarLogin = async function() {
  var emailEl = (
    document.getElementById('login-email') ||
    document.getElementById('email') ||
    document.querySelector('input[type="email"]')
  );
  var passEl = (
    document.getElementById('login-pass') ||
    document.getElementById('login-password') ||
    document.getElementById('password') ||
    document.querySelector('input[type="password"]')
  );
 
  var email    = emailEl ? emailEl.value.trim() : '';
  var password = passEl  ? passEl.value         : '';
 
  if (!email || !password) {
    if (typeof mostrarTostada === 'function') mostrarTostada('Ingresá tu email y contraseña.', 'warning');
    return;
  }
 
  var btnLogin = (
    document.getElementById('btn-login') ||
    document.getElementById('login-btn') ||
    document.querySelector('button[onclick*="intentarLogin"]') ||
    document.querySelector('button[type="submit"]')
  );
  var textoOriginal = btnLogin ? btnLogin.textContent : '';
  if (btnLogin) { btnLogin.disabled = true; btnLogin.textContent = 'Ingresando...'; }
 
  try {
    var response = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: email, password: password }),
    });
 
    if (!response) return;
 
    var token   = (response.data && (response.data.token || response.data.accessToken)) || response.token;
    var usuario = _extraerUsuario(response);
 
    if (!token || !usuario) {
      if (typeof mostrarTostada === 'function') mostrarTostada('Respuesta inesperada del servidor. Revisá la consola.', 'danger');
      console.error('[Login] Estructura no reconocida:', response);
      return;
    }
 
    localStorage.setItem('mg_token',   token);
    localStorage.setItem('mg_usuario', JSON.stringify(usuario));
    usuario.email = usuario.email || email;
 
    _token   = token;
    _usuario = usuario;
 
    window._onLoginExitosoBackend(usuario);
 
  } finally {
    if (btnLogin) { btnLogin.disabled = false; btnLogin.textContent = textoOriginal; }
  }
};
 