/**
 * MediGest Pro · Cliente WebSocket
 * ---------------------------------------------------------------------------
 * Conecta al backend en /ws?token=<jwt>, maneja reconexión con backoff
 * exponencial y despacha eventos al sistema visual existente.
 *
 * Uso: importar en app.js después del login exitoso:
 *   import { conectarWS, desconectarWS } from './websocket.client.js';
 *   conectarWS(token);
 */

const WS_BASE = (window.API_BASE || 'http://localhost:8000').replace(/^http/, 'ws');

// Tiempos de backoff en ms: 1s, 2s, 4s, 8s, 16s, 30s (tope)
const BACKOFF_MS  = [1000, 2000, 4000, 8000, 16000, 30000];
const BACKOFF_MAX = 30000;

let ws            = null;
let tokenActual   = null;
let intentos      = 0;
let timerReconect = null;
let cerradoManual = false;

// ---------------------------------------------------------------------------
// Conexión
// ---------------------------------------------------------------------------

/**
 * Abre la conexión WebSocket autenticada.
 * Llamar luego de un login exitoso con el JWT recibido.
 * @param {string} token JWT de acceso
 */
export function conectarWS(token) {
  tokenActual  = token;
  cerradoManual = false;
  _abrir();
}

/**
 * Cierra la conexión de forma limpia (logout, cambio de cuenta).
 */
export function desconectarWS() {
  cerradoManual = true;
  clearTimeout(timerReconect);
  if (ws) ws.close(1000, 'Logout');
  ws = null;
}

function _abrir() {
  if (!tokenActual) return;

  const url = `${WS_BASE}/ws?token=${tokenActual}`;
  ws = new WebSocket(url);

  ws.addEventListener('open', _onOpen);
  ws.addEventListener('message', _onMessage);
  ws.addEventListener('close', _onClose);
  ws.addEventListener('error', _onError);
}

// ---------------------------------------------------------------------------
// Handlers de conexión
// ---------------------------------------------------------------------------

function _onOpen() {
  intentos = 0;
  console.info('[WS] Conectado al servidor de notificaciones.');

  // Keepalive: enviar ping cada 20s para evitar que proxies cierren la conexión
  _iniciarPing();
}

function _onClose(event) {
  _detenerPing();
  if (cerradoManual) return;

  const espera = BACKOFF_MS[Math.min(intentos, BACKOFF_MS.length - 1)] ?? BACKOFF_MAX;
  intentos++;
  console.warn(`[WS] Conexión cerrada (${event.code}). Reconectando en ${espera / 1000}s… (intento ${intentos})`);
  timerReconect = setTimeout(_abrir, espera);
}

function _onError(err) {
  console.error('[WS] Error de conexión:', err);
  // _onClose se dispara automáticamente después del error
}

// ---------------------------------------------------------------------------
// Despacho de mensajes entrantes
// ---------------------------------------------------------------------------

function _onMessage(event) {
  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch {
    console.warn('[WS] Mensaje no parseable:', event.data);
    return;
  }

  const { tipo, ts, ...datos } = payload;

  switch (tipo) {
    case 'conectado':
      console.info(`[WS] ${datos.mensaje}`);
      break;

    case 'turno_llegada':
      _manejarTurnoLlegada(datos);
      break;

    case 'resultado_lab':
      _manejarResultadoLab(datos);
      break;

    case 'cama_liberada':
      _manejarCamaLiberada(datos);
      break;

    case 'guardia_ingreso':
      _manejarGuardiaIngreso(datos);
      break;

    case 'mensaje_nuevo':
      _manejarMensajeNuevo(datos);
      break;

    case 'pong':
      // keepalive respondido — no hacer nada
      break;

    case 'error':
      console.error('[WS] Error del servidor:', datos.mensaje);
      break;

    default:
      console.debug('[WS] Evento desconocido:', tipo, datos);
  }
}

// ---------------------------------------------------------------------------
// Handlers de cada evento → integración con el sistema visual existente
// ---------------------------------------------------------------------------

function _manejarTurnoLlegada({ paciente, hora, especialidad }) {
  mostrarTostada(`🟢 Turno llegó: ${paciente} — ${especialidad} ${hora}`, 'success');
  _incrementarContador('contador-sala-espera');
  _actualizarEstadoTurno(paciente, 'en_sala');
}

function _manejarResultadoLab({ paciente, estudio, medico_id }) {
  mostrarTostada(`🔬 Resultado disponible: ${estudio} — ${paciente}`, 'info');
  _incrementarContador('contador-lab-pendientes');
}

function _manejarCamaLiberada({ cama, sector }) {
  mostrarTostada(`🛏 Cama ${cama} liberada — ${sector}`, 'warning');
  _decrementarContador('contador-camas-ocupadas');
  // Refrescar grilla de camas si el módulo está activo
  if (typeof actualizarGrillaCamas === 'function') actualizarGrillaCamas();
}

function _manejarGuardiaIngreso({ nivel_triage, paciente }) {
  const colores = { rojo: '🔴', naranja: '🟠', amarillo: '🟡', verde: '🟢', azul: '🔵' };
  const icono   = colores[nivel_triage] ?? '⚪';
  mostrarTostada(`${icono} Guardia: ${paciente} — triage ${nivel_triage.toUpperCase()}`, 'danger');
  _incrementarContador('contador-guardia');
}

function _manejarMensajeNuevo({ de, preview }) {
  mostrarTostada(`💬 ${de}: ${preview}`, 'info');
  _incrementarContador('contador-mensajes');
}

// ---------------------------------------------------------------------------
// Utilidades de UI
// ---------------------------------------------------------------------------

/**
 * Llama a mostrarTostada() del sistema visual existente.
 * Si no existe, hace fallback a console.
 * @param {string} texto
 * @param {'success'|'info'|'warning'|'danger'} tipo
 */
function mostrarTostada(texto, tipo = 'info') {
  if (typeof window.mostrarTostada === 'function') {
    window.mostrarTostada(texto, tipo);
  } else {
    console.info(`[Tostada ${tipo}] ${texto}`);
  }
}

/** Incrementa en 1 el número dentro de un elemento por ID. */
function _incrementarContador(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const actual = parseInt(el.textContent, 10) || 0;
  el.textContent = actual + 1;
}

/** Decrementa en 1 el número dentro de un elemento por ID (mínimo 0). */
function _decrementarContador(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const actual = parseInt(el.textContent, 10) || 0;
  el.textContent = Math.max(0, actual - 1);
}

/** Actualiza el estado visual de un turno en la tabla de agenda. */
function _actualizarEstadoTurno(paciente, nuevoEstado) {
  // Busca filas de la tabla de turnos que contengan el nombre del paciente
  document.querySelectorAll('[data-paciente]').forEach((el) => {
    if (el.dataset.paciente === paciente) {
      const badge = el.querySelector('.estado-turno');
      if (badge) badge.textContent = nuevoEstado.replace('_', ' ');
    }
  });
}

// ---------------------------------------------------------------------------
// Keepalive ping
// ---------------------------------------------------------------------------

let _pingTimer = null;

function _iniciarPing() {
  _pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ tipo: 'ping' }));
    }
  }, 20_000);
}

function _detenerPing() {
  clearInterval(_pingTimer);
  _pingTimer = null;
}
