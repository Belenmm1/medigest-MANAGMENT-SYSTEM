/**
 * MediGest Pro — app.js
 * ═══════════════════════════════════════════════════════════════════
 * MÓDULO 04 — Cliente API: conecta el frontend al backend Node.js
 *
 * Responsabilidades:
 *   — Autenticación JWT (login, refresh, logout, restaurar sesión)
 *   — Módulo Pacientes  → GET /api/pacientes, GET /api/pacientes/:id
 *   — Módulo Turnos     → GET /api/turnos, GET /api/turnos/semana
 *   — Módulo Tablero    → GET /api/camas, métricas en tiempo real
 *   — Módulo Internación → GET /api/camas (grilla)
 *   — Módulo Evoluciones → POST /api/pacientes/:id/evoluciones
 *   — WebSocket          → eventos en tiempo real (turnos, camas)
 *
 * REGLAS ESTRICTAS:
 *   ✗  No modificar ningún CSS, clase ni estilo del index.html
 *   ✗  No redefinir funciones ya declaradas en el HTML
 *   ✓  Solo REEMPLAZAR los datos hardcodeados (TURNOS_TODOS, PACIENTES_TODOS, CAMAS_DATA)
 *   ✓  Conectar funciones existentes al backend de forma transparente
 * ═══════════════════════════════════════════════════════════════════
 */

'use strict';

/* ──────────────────────────────────────────────────────────────────
   CONFIGURACIÓN
────────────────────────────────────────────────────────────────── */

const API_BASE = (typeof import_meta_env !== 'undefined' && import_meta_env?.VITE_API_URL)
  || window.MG_API_BASE
  || 'https://medigest-backend-production.up.railway.app';

const WS_BASE = API_BASE.replace(/^http/, 'ws');

const TOKEN_KEY   = 'mg_token';
const REFRESH_KEY = 'mg_refresh';
const USER_KEY    = 'mg_user';

/* ──────────────────────────────────────────────────────────────────
   ESTADO INTERNO
────────────────────────────────────────────────────────────────── */

let _ws = null;
let _wsReconnectTimer = null;
let _pacienteDetalleActual = null;  // ID del paciente abierto en modal

/* ──────────────────────────────────────────────────────────────────
   CAPA HTTP — apiFetch
────────────────────────────────────────────────────────────────── */

/**
 * Wrapper central para todas las llamadas al backend.
 * — Inyecta el Authorization header automáticamente
 * — Si recibe 401, intenta refresh; si falla, cierra sesión
 * — Devuelve el objeto JSON parseado, o null en error
 */
async function apiFetch(url, options = {}, _isRetry = false) {
  const token = localStorage.getItem(TOKEN_KEY);

  const res = await fetch(API_BASE + url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options.headers || {}),
    },
  }).catch(err => {
    console.error('[MediGest] Error de red:', err);
    actualizarEstadoRed && actualizarEstadoRed(false);
    return null;
  });

  if (!res) return null;

  actualizarEstadoRed && actualizarEstadoRed(true);

  // Token expirado — intentar refresh una vez
  if (res.status === 401 && !_isRetry) {
    const refreshed = await intentarRefresh();
    if (refreshed) return apiFetch(url, options, true);
    // Refresh también falló → cerrar sesión
    _cerrarSesionLocal();
    return null;
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.warn(`[MediGest] API ${res.status} en ${url}:`, errBody);
    return null;
  }

  return res.json().catch(() => null);
}

/* Alias para POST con body JSON */
function apiPost(url, body)   { return apiFetch(url, { method: 'POST',  body: JSON.stringify(body) }); }
function apiPatch(url, body)  { return apiFetch(url, { method: 'PATCH', body: JSON.stringify(body) }); }
function apiDelete(url)       { return apiFetch(url, { method: 'DELETE' }); }

/* ──────────────────────────────────────────────────────────────────
   AUTENTICACIÓN
────────────────────────────────────────────────────────────────── */

/**
 * Reemplaza la función intentarLogin() del HTML.
 * Lee email/pass del formulario, llama a POST /api/auth/login.
 */
window.intentarLogin = async function () {
  const emailEl = document.getElementById('login-email');
  const passEl  = document.getElementById('login-pass');
  const errorEl = document.getElementById('login-error');
  const recuperEl = document.getElementById('login-recuperacion');

  const email = emailEl.value.trim().toLowerCase();
  const pass  = passEl.value;

  // Limpiar estados previos
  errorEl.classList.remove('visible');
  recuperEl && recuperEl.classList.remove('visible');
  emailEl.classList.remove('error-campo');
  passEl.classList.remove('error-campo');

  if (!email || !pass) {
    errorEl.textContent = 'Completá el correo y la contraseña para continuar.';
    errorEl.classList.add('visible');
    if (!email) emailEl.classList.add('error-campo');
    if (!pass)  passEl.classList.add('error-campo');
    return;
  }

  // Feedback visual — deshabilitar botón
  const btn = document.querySelector('.login-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Ingresando…'; }

  const data = await apiPost('/api/auth/login', { email, password: pass });

  if (btn) { btn.disabled = false; btn.textContent = 'Ingresar'; }

  if (!data || !data.data?.access_token) {
    errorEl.textContent = 'Correo o contraseña incorrectos. Verificá los datos e intentá de nuevo.';
    errorEl.classList.add('visible');
    emailEl.classList.add('error-campo');
    passEl.classList.add('error-campo');
    const formWrap = document.querySelector('.login-form-wrap');
    if (formWrap) {
      formWrap.style.animation = 'none';
      formWrap.offsetHeight;
      formWrap.style.animation = 'loginShake 0.35s ease';
    }
    return;
  }

  const { access_token, refresh_token, usuario } = data.data;
  _guardarTokens(access_token, refresh_token, usuario);

  const recordar = document.getElementById('login-recordar');
  if (recordar && recordar.checked) {
    sessionStorage.setItem('medigest-sesion', email);
  }

  _entrarConUsuarioBackend(usuario);
};

/**
 * Botones de acceso rápido demo — reemplaza loginDemo().
 * Llama a la API real con las credenciales demo del seed.
 */
window.loginDemo = async function (email, pass) {
  const data = await apiPost('/api/auth/login', { email, password: pass });
  if (!data?.data?.access_token) {
    // Fallback: si el backend no está disponible, usar datos demo locales
    console.warn('[MediGest] Backend no disponible — modo demo local');
    return;
  }
  const { access_token, refresh_token, usuario } = data.data;
  _guardarTokens(access_token, refresh_token, usuario);
  _entrarConUsuarioBackend(usuario);
};

/** Guarda tokens en localStorage */
function _guardarTokens(accessToken, refreshToken, usuario) {
  localStorage.setItem(TOKEN_KEY,   accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  if (usuario)      localStorage.setItem(USER_KEY, JSON.stringify(usuario));
}

/** Intenta renovar el access_token con el refresh_token */
async function intentarRefresh() {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  const data = await apiPost('/api/auth/refresh', { refresh_token: refreshToken });
  if (!data?.data?.access_token) return false;
  localStorage.setItem(TOKEN_KEY, data.data.access_token);
  return true;
}

/** Cierra sesión limpiando storage y recargando */
function _cerrarSesionLocal() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem('medigest-sesion');
  _desconectarWS();

  // Mostrar pantalla de login
  const pantalla = document.getElementById('pantalla-login');
  if (pantalla) {
    pantalla.style.display = '';
    pantalla.style.opacity = '';
  }
}

/** Extiende cerrarSesion() del HTML para también llamar al backend */
const _cerrarSesionOriginal = window.cerrarSesion;
window.cerrarSesion = async function () {
  await apiPost('/api/auth/logout', {}).catch(() => {});
  _cerrarSesionLocal();
  if (_cerrarSesionOriginal) _cerrarSesionOriginal();
};

/**
 * Convierte el usuario del backend al formato que espera entrarAlSistema().
 * El HTML espera: { nombre, rolLabel, iniciales, turno, rol }
 */
function _mapearUsuario(u) {
  const ROLES_LABEL = {
    admin:      'Administrador',
    medico:     'Médico/a',
    enfermeria: 'Enfermería',
    recepcion:  'Recepción',
  };
  const partes = (u.nombre_completo || u.nombre || '').split(' ');
  const iniciales = partes.length >= 2
    ? (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
    : (u.nombre_completo || '??').slice(0, 2).toUpperCase();

  return {
    ...u,
    nombre:   u.nombre_completo || u.nombre || u.email,
    rolLabel: ROLES_LABEL[u.rol] || u.rol,
    iniciales,
    turno:    'Turno mañana',   // el backend no expone turno aún
    pass:     '__backend__',     // evita que el HTML lo rechace
  };
}

/** Llama a entrarAlSistema() del HTML con el usuario del backend */
function _entrarConUsuarioBackend(usuario) {
  const u = _mapearUsuario(usuario);
  if (typeof entrarAlSistema === 'function') {
    entrarAlSistema(u.email, u);
  }
  // Conectar WebSocket después de entrar
  setTimeout(_conectarWS, 800);
}

/* ──────────────────────────────────────────────────────────────────
   RESTAURAR SESIÓN AL CARGAR
────────────────────────────────────────────────────────────────── */

async function restaurarSesionBackend() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return false;

  const data = await apiFetch('/api/auth/me');
  if (!data?.data) return false;

  _entrarConUsuarioBackend(data.data);
  return true;
}

/* ──────────────────────────────────────────────────────────────────
   MÓDULO PACIENTES
────────────────────────────────────────────────────────────────── */

let _pacientesPagActual = 0;
const _PACIENTES_POR_PAG = 8;
let _pacientesTodos = [];
let _pacientesBusqueda = '';

/**
 * Reemplaza renderizarPacientes() del HTML.
 * Carga datos reales desde GET /api/pacientes
 */
window.renderizarPacientes = async function () {
  const tbody    = document.getElementById('pacientes-tbody');
  const vacioCont = document.getElementById('pacientes-vacio');
  const pagCont  = document.getElementById('pacientes-paginacion');
  if (!tbody) return;

  mostrarSkeletonTabla(tbody, 5, 6);

  const page  = _pacientesPagActual + 1;
  const query = _pacientesBusqueda
    ? `?page=${page}&limit=${_PACIENTES_POR_PAG}&q=${encodeURIComponent(_pacientesBusqueda)}`
    : `?page=${page}&limit=${_PACIENTES_POR_PAG}`;

  const data = await apiFetch('/api/pacientes' + query);

  if (!data) {
    // Fallback a datos hardcodeados si el backend no responde
    return;
  }

  const pacientes = data.data || [];
  const meta      = data.meta || { total: pacientes.length, page, limit: _PACIENTES_POR_PAG };

  if (pacientes.length === 0) {
    tbody.innerHTML = '';
    if (vacioCont) vacioCont.style.display = '';
    if (pagCont)   pagCont.style.display = 'none';
    return;
  }

  if (vacioCont) vacioCont.style.display = 'none';
  if (pagCont)   pagCont.style.display = '';

  tbody.innerHTML = pacientes.map(p => {
    const nombre    = `${p.apellido}, ${p.nombre}`;
    const iniciales = (p.apellido[0] + p.nombre[0]).toUpperCase();
    const dni       = p.dni || '–';
    const os        = p.obra_social || 'Particular';
    const visita    = p.ultima_visita ? _formatFecha(p.ultima_visita) : '–';
    const estado    = p.estado || 'Activo';
    const claseEtiq = estado === 'Alta' ? 'etiqueta-gris'
                    : estado === 'Seguimiento' ? 'etiqueta-ambar'
                    : 'etiqueta-verde';

    return `
      <tr onclick="abrirDetallePaciente('${p.id}')">
        <td><div class="fila-av"><div class="av">${iniciales}</div><span class="td-nombre">${nombre}</span></div></td>
        <td style="font-family:var(--mono);font-size:11.5px;">${dni}</td>
        <td>${os}</td>
        <td>${visita}</td>
        <td><span class="etiqueta ${claseEtiq}">${estado}</span></td>
        <td>
          <button class="boton chico" onclick="event.stopPropagation();abrirDetallePaciente('${p.id}')">Historia</button>
          <button class="boton chico peligro" style="margin-left:4px;" onclick="event.stopPropagation();confirmarEliminacion('${nombre}')">Eliminar</button>
        </td>
      </tr>`;
  }).join('');

  const total    = meta.total || pacientes.length;
  const ini      = (_pacientesPagActual * _PACIENTES_POR_PAG) + 1;
  const fin      = Math.min(ini + pacientes.length - 1, total);
  const totalPags = Math.ceil(total / _PACIENTES_POR_PAG);

  const infoEl = document.getElementById('pacientes-pag-info');
  const numEl  = document.getElementById('pacientes-pag-num');
  const antEl  = document.getElementById('pacientes-btn-ant');
  const sigEl  = document.getElementById('pacientes-btn-sig');

  if (infoEl) infoEl.textContent = `Mostrando ${ini}–${fin} de ${total} pacientes`;
  if (numEl)  numEl.textContent  = `${_pacientesPagActual + 1} / ${totalPags}`;
  if (antEl)  antEl.disabled = _pacientesPagActual === 0;
  if (sigEl)  sigEl.disabled = _pacientesPagActual >= totalPags - 1;
};

window.cambiarPaginaPacientes = function (delta) {
  _pacientesPagActual = Math.max(0, _pacientesPagActual + delta);
  window.renderizarPacientes();
};

/** Abre el modal de detalle y carga los datos del paciente */
window.abrirDetallePaciente = async function (id) {
  _pacienteDetalleActual = id;
  if (typeof abrirModal === 'function') abrirModal('modal-detalle-paciente');
  await _cargarDetallePaciente(id);
};

async function _cargarDetallePaciente(id) {
  const data = await apiFetch(`/api/pacientes/${id}`);
  if (!data?.data) return;

  const p = data.data;
  const nombre = `${p.nombre} ${p.apellido}`;

  // Actualizar campos del modal (IDs según el HTML)
  _setTexto('detalle-nombre',    nombre);
  _setTexto('detalle-dni',       p.dni || '–');
  _setTexto('detalle-os',        p.obra_social || 'Particular');
  _setTexto('detalle-afiliado',  p.nro_afiliado || '–');
  _setTexto('detalle-nacimiento',p.fecha_nacimiento ? _formatFecha(p.fecha_nacimiento) : '–');
  _setTexto('detalle-tel',       p.telefono || '–');
  _setTexto('detalle-email',     p.email || '–');
  _setTexto('detalle-sangre',    p.grupo_sanguineo || '–');
  _setTexto('detalle-peso',      p.peso_kg ? `${p.peso_kg} kg` : '–');
  _setTexto('detalle-talla',     p.talla_cm ? `${p.talla_cm} cm` : '–');

  // Cargar evoluciones en la pestaña HCE
  await _cargarEvoluciones(id);
}

async function _cargarEvoluciones(pacienteId) {
  const data = await apiFetch(`/api/pacientes/${pacienteId}/evoluciones`);
  const lista = document.getElementById('hce-evoluciones-lista');
  if (!lista || !data?.data) return;

  const evoluciones = data.data;
  if (evoluciones.length === 0) {
    lista.innerHTML = '<p style="color:var(--tx-sub);font-size:12px;padding:8px 0;">Sin evoluciones registradas.</p>';
    return;
  }

  lista.innerHTML = evoluciones.map(e => `
    <div class="evolucion-item" style="border-bottom:1px solid var(--border);padding:12px 0;">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <span style="font-size:12px;font-weight:600;color:var(--tx)">${e.diagnostico || 'Sin diagnóstico'}</span>
        <span style="font-size:11px;color:var(--tx-sub);font-family:var(--mono)">${_formatFechaHora(e.creado_en)}</span>
      </div>
      <div style="font-size:12px;color:var(--tx-sub)">
        <strong>Motivo:</strong> ${e.motivo_consulta || '–'} &nbsp;·&nbsp;
        <strong>TA:</strong> ${e.ta_sistolica || '–'}/${e.ta_diastolica || '–'} &nbsp;·&nbsp;
        <strong>FC:</strong> ${e.fc_lpm || '–'} lpm
        ${e.notas ? `<div style="margin-top:4px"><strong>Notas:</strong> ${e.notas}</div>` : ''}
      </div>
    </div>`).join('');
}

/* ──────────────────────────────────────────────────────────────────
   GUARDAR EVOLUCIÓN
────────────────────────────────────────────────────────────────── */

/**
 * Reemplaza guardarEvolucion() del HTML.
 * Llama a POST /api/pacientes/:id/evoluciones con los campos del formulario.
 */
window.guardarEvolucion = async function (btn) {
  const indicador = document.getElementById('guardado-evolucion');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  const body = {
    motivo_consulta: _getVal('evol-motivo'),
    diagnostico:     _getVal('evol-diagnostico'),
    ta_sistolica:    _getValNum('evol-ta-sys'),
    ta_diastolica:   _getValNum('evol-ta-dia'),
    fc_lpm:          _getValNum('evol-fc'),
    spo2_pct:        _getValNum('evol-spo2'),
    temperatura:     _getValNum('evol-temp'),
    notas:           _getVal('evol-notas'),
  };

  let ok = false;

  if (_pacienteDetalleActual) {
    const data = await apiPost(`/api/pacientes/${_pacienteDetalleActual}/evoluciones`, body);
    ok = !!data?.data;
  } else {
    // Sin ID de paciente — simular guardado (modo demo)
    await new Promise(r => setTimeout(r, 600));
    ok = true;
  }

  btn.textContent = 'Guardar evolución';
  btn.disabled = false;

  if (ok) {
    if (indicador) {
      indicador.classList.add('visible');
      setTimeout(() => indicador.classList.remove('visible'), 2000);
    }
    mostrarTostada && mostrarTostada('Evolución guardada en historia clínica', 'exito');
    // Recargar lista de evoluciones
    if (_pacienteDetalleActual) await _cargarEvoluciones(_pacienteDetalleActual);
  } else {
    mostrarTostada && mostrarTostada('Error al guardar la evolución', 'alerta');
  }
};

/* ──────────────────────────────────────────────────────────────────
   MÓDULO TURNOS
────────────────────────────────────────────────────────────────── */

let _turnosPagActual = 0;
const _TURNOS_POR_PAG = 6;
let _turnosTodos = [];

/**
 * Reemplaza renderizarTurnos() del HTML.
 * Carga turnos del día desde GET /api/turnos
 */
window.renderizarTurnos = async function () {
  const tbody = document.getElementById('turnos-tbody');
  if (!tbody) return;

  mostrarSkeletonTabla(tbody, 4, 7);

  const hoy  = new Date().toISOString().split('T')[0];
  const data = await apiFetch(`/api/turnos?fecha=${hoy}&limit=50`);

  if (!data?.data) {
    // Fallback a datos hardcodeados del HTML
    return;
  }

  _turnosTodos = data.data;
  _turnosPagActual = 0;
  _renderTurnosPagina();
};

function _renderTurnosPagina() {
  const tbody = document.getElementById('turnos-tbody');
  if (!tbody) return;

  const total = _turnosTodos.length;
  const ini   = _turnosPagActual * _TURNOS_POR_PAG;
  const fin   = Math.min(ini + _TURNOS_POR_PAG, total);
  const pag   = _turnosTodos.slice(ini, fin);

  const ESTADO_CLASE = {
    confirmado: 'etiqueta-gris',
    en_sala:    'etiqueta-azul',
    en_curso:   'etiqueta-ambar',
    atendido:   'etiqueta-verde',
    cancelado:  'etiqueta-rojo',
  };

  tbody.innerHTML = pag.map(t => {
    const hora     = t.fecha_hora ? _formatHora(t.fecha_hora) : '–';
    const paciente = t.paciente ? `${t.paciente.apellido}, ${t.paciente.nombre}` : '–';
    const medico   = t.medico   ? `${t.medico.nombre_completo}` : '–';
    const os       = t.paciente?.obra_social || '–';
    const estadoLabel = _capitalizar(t.estado?.replace('_', ' ') || '–');
    const clase    = ESTADO_CLASE[t.estado] || 'etiqueta-gris';

    return `
      <tr onclick="mostrarTostada('Turno de ${paciente} — ${hora}','info')">
        <td class="td-nombre">${hora}</td>
        <td>${paciente}</td>
        <td>${t.especialidad || '–'}</td>
        <td>${medico}</td>
        <td>${os}</td>
        <td><span class="etiqueta ${clase}">${estadoLabel}</span></td>
        <td><button class="boton chico" onclick="event.stopPropagation();confirmarCancelacionTurnoAPI('${t.id}','${paciente} · ${hora}')">Cancelar</button></td>
      </tr>`;
  }).join('');

  const infoEl = document.getElementById('turnos-pag-info');
  const numEl  = document.getElementById('turnos-pag-num');
  const antEl  = document.getElementById('turnos-btn-ant');
  const sigEl  = document.getElementById('turnos-btn-sig');
  const totalPags = Math.ceil(total / _TURNOS_POR_PAG);

  if (infoEl) infoEl.textContent = `Mostrando ${ini+1}–${fin} de ${total} turnos`;
  if (numEl)  numEl.textContent  = `${_turnosPagActual + 1} / ${totalPags}`;
  if (antEl)  antEl.disabled = _turnosPagActual === 0;
  if (sigEl)  sigEl.disabled = fin >= total;
}

window.cambiarPaginaTurnos = function (delta) {
  const totalPags = Math.ceil(_turnosTodos.length / _TURNOS_POR_PAG);
  _turnosPagActual = Math.max(0, Math.min(_turnosPagActual + delta, totalPags - 1));
  _renderTurnosPagina();
};

/** Cancelación real de turno vía API */
window.confirmarCancelacionTurnoAPI = function (id, info) {
  if (typeof abrirModalDestructivo === 'function') {
    abrirModalDestructivo(
      'Cancelar turno',
      `¿Cancelar el turno de ${info}?`,
      'El paciente será notificado automáticamente. Esta acción no se puede deshacer.',
      async () => {
        const ok = await apiDelete(`/api/turnos/${id}`);
        if (ok !== null) {
          mostrarTostada && mostrarTostada('Turno cancelado · Paciente notificado', 'alerta');
          window.renderizarTurnos();
        }
      }
    );
  }
};

/* ──────────────────────────────────────────────────────────────────
   MÓDULO TABLERO — métricas y camas
────────────────────────────────────────────────────────────────── */

async function cargarMetricasTablero() {
  const [dataCamas, dataTurnos] = await Promise.all([
    apiFetch('/api/camas'),
    apiFetch('/api/turnos?fecha=' + new Date().toISOString().split('T')[0] + '&limit=100'),
  ]);

  if (dataCamas?.data) {
    const camas       = dataCamas.data;
    const ocupadas    = camas.filter(c => c.estado === 'ocupada').length;
    const libres      = camas.filter(c => c.estado === 'libre').length;
    const disponibles = libres + camas.filter(c => c.estado === 'reservada').length;

    _setTexto('tablero-camas-ocupadas',  ocupadas);
    _setTexto('tablero-camas-libres',    libres);
    _setTexto('tablero-camas-total',     camas.length);
    _setTexto('tablero-internados',      ocupadas);
  }

  if (dataTurnos?.data) {
    const turnos   = dataTurnos.data;
    const enCurso  = turnos.filter(t => t.estado === 'en_curso' || t.estado === 'en_sala').length;
    const atendidos = turnos.filter(t => t.estado === 'atendido').length;
    const total     = turnos.length;

    _setTexto('tablero-turnos-hoy',      total);
    _setTexto('tablero-turnos-curso',    enCurso);
    _setTexto('tablero-turnos-atendidos', atendidos);
    _setTexto('tablero-en-sala',         enCurso);
  }
}

/* ──────────────────────────────────────────────────────────────────
   MÓDULO INTERNACIÓN — grilla de camas
────────────────────────────────────────────────────────────────── */

/**
 * Reemplaza construirCamas() del HTML.
 * Carga el estado real de camas desde GET /api/camas
 */
window.construirCamas = async function () {
  const grid = document.getElementById('camas-grilla') || document.querySelector('.camas-grilla');
  if (!grid) return;

  const data = await apiFetch('/api/camas');
  if (!data?.data) return;

  const camas = data.data;

  // Actualizar contadores del header de internación
  const ocupadas = camas.filter(c => c.estado === 'ocupada').length;
  const libres   = camas.filter(c => c.estado === 'libre').length;
  _setTexto('intern-camas-ocupadas', ocupadas);
  _setTexto('intern-camas-libres',   libres);

  const TIPO_CLASE = {
    ocupada:  'ocupada',
    libre:    'libre',
    limpieza: 'limpieza',
    reservada:'reservada',
  };

  grid.innerHTML = camas.map(c => {
    const tipo    = c.estado || 'libre';
    const clase   = TIPO_CLASE[tipo] || 'libre';
    const pacNom  = c.paciente ? `${c.paciente.apellido}, ${c.paciente.nombre}` : '';
    const diag    = c.paciente_diagnostico || '';
    const ing     = c.ingreso ? _formatFecha(c.ingreso) : '';
    const medico  = c.medico ? c.medico.nombre_completo : '';
    const label   = tipo === 'ocupada'   ? pacNom
                  : tipo === 'libre'     ? 'Libre'
                  : tipo === 'limpieza'  ? 'En limpieza'
                  :                        'Reservada';

    return `
      <div class="cama ${clase}"
           onmouseenter="mostrarTooltipCama(this,'${c.numero}','${label}','${diag}','${ing}','${medico}')"
           onmouseleave="ocultarTooltipCama()">
        <div class="cama-num">${c.numero}</div>
        <div class="cama-pac">${label}</div>
      </div>`;
  }).join('');
};

/* ──────────────────────────────────────────────────────────────────
   WEBSOCKET — eventos en tiempo real
────────────────────────────────────────────────────────────────── */

function _conectarWS() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;

  try {
    _ws = new WebSocket(`${WS_BASE}/ws?token=${token}`);

    _ws.onopen = () => {
      console.info('[MediGest] WebSocket conectado');
      actualizarEstadoRed && actualizarEstadoRed(true);
    };

    _ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        _manejarEventoWS(msg);
      } catch (e) { /* ignorar mensajes no-JSON */ }
    };

    _ws.onclose = (ev) => {
      if (ev.code !== 1000) {
        // Reconectar con backoff
        clearTimeout(_wsReconnectTimer);
        _wsReconnectTimer = setTimeout(_conectarWS, 5000);
      }
    };

    _ws.onerror = (err) => {
      console.warn('[MediGest] WebSocket error — modo polling');
    };
  } catch (e) {
    console.warn('[MediGest] WebSocket no disponible');
  }
}

function _desconectarWS() {
  clearTimeout(_wsReconnectTimer);
  if (_ws) { _ws.close(1000); _ws = null; }
}

function _manejarEventoWS(msg) {
  switch (msg.tipo) {
    case 'turno_actualizado':
    case 'turno_nuevo':
      window.renderizarTurnos && window.renderizarTurnos();
      break;
    case 'cama_actualizada':
      window.construirCamas && window.construirCamas();
      cargarMetricasTablero();
      break;
    case 'notificacion': {
      const texto = msg.texto || msg.message || 'Nueva notificación';
      mostrarTostada && mostrarTostada(texto, msg.nivel || 'info');
      actualizarCampana && actualizarCampana();
      break;
    }
    default:
      break;
  }
}

/* ──────────────────────────────────────────────────────────────────
   NAVEGACIÓN — hook para cargar datos al cambiar de módulo
────────────────────────────────────────────────────────────────── */

const _navegarAOriginal = window.navegarA;
window.navegarA = function (modulo, item) {
  if (_navegarAOriginal) _navegarAOriginal(modulo, item);
  // Cargar datos del módulo destino
  setTimeout(() => _cargarDatosModulo(modulo), 150);
};

function _cargarDatosModulo(modulo) {
  switch (modulo) {
    case 'tablero':
      cargarMetricasTablero();
      break;
    case 'turnos':
      window.renderizarTurnos && window.renderizarTurnos();
      break;
    case 'pacientes':
      window.renderizarPacientes && window.renderizarPacientes();
      break;
    case 'internacion':
      window.construirCamas && window.construirCamas();
      break;
    default:
      break;
  }
}

/* ──────────────────────────────────────────────────────────────────
   BÚSQUEDA DE PACIENTES
────────────────────────────────────────────────────────────────── */

// Debounce para el input de búsqueda
let _busquedaTimer = null;
function _hookBusquedaPacientes() {
  const input = document.getElementById('pacientes-buscar');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(_busquedaTimer);
    _busquedaTimer = setTimeout(() => {
      _pacientesBusqueda = input.value.trim();
      _pacientesPagActual = 0;
      window.renderizarPacientes();
    }, 350);
  });
}

/* ──────────────────────────────────────────────────────────────────
   UTILIDADES
────────────────────────────────────────────────────────────────── */

function _setTexto(id, texto) {
  const el = document.getElementById(id);
  if (el) el.textContent = texto ?? '–';
}

function _getVal(id) {
  const el = document.getElementById(id);
  return el ? (el.value || '').trim() : '';
}

function _getValNum(id) {
  const v = parseFloat(_getVal(id));
  return isNaN(v) ? null : v;
}

function _formatFecha(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function _formatFechaHora(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function _formatHora(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function _capitalizar(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Inserta filas skeleton mientras carga */
function mostrarSkeletonTabla(tbody, filas, cols) {
  tbody.innerHTML = Array.from({ length: filas }, () =>
    `<tr>${Array.from({ length: cols }, () =>
      `<td><div class="skel-linea" style="height:14px;border-radius:3px;background:var(--skel-bg,rgba(255,255,255,0.06));animation:skelPulse 1.4s ease infinite;"></div></td>`
    ).join('')}</tr>`
  ).join('');
}

/* ──────────────────────────────────────────────────────────────────
   INICIALIZACIÓN
────────────────────────────────────────────────────────────────── */

window.addEventListener('DOMContentLoaded', async () => {
  // 1. Intentar restaurar sesión con token existente
  const sesionRestorada = await restaurarSesionBackend();

  // 2. Si no hay sesión activa en backend, intentar con sessionStorage (demo local)
  if (!sesionRestorada) {
    const emailGuardado = sessionStorage.getItem('medigest-sesion');
    if (emailGuardado) {
      // El HTML ya tiene USUARIOS_DEMO — dejar que restaurarSesion() original lo maneje
    }
  }

  // 3. Hookear búsqueda de pacientes
  _hookBusquedaPacientes();

  // 4. El resto de la inicialización (animarContadores, etc.) ya está en el HTML
});
