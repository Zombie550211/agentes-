const STATUS_COMPLETED  = new Set(['completed','active','completado','activo','activa','vendido','cerrado','cerrada','venta cerrada']);
const STATUS_PENDING    = new Set(['pending','pendiente','pendientes']);
const STATUS_CANCELLED  = new Set(['cancelled','canceled','cancelado','cancelada']);
const STATUS_HOLD       = new Set(['hold','en hold','pausado','pausa']);
const STATUS_RESERVA    = new Set(['reserva','ventas en reserva','reserved','reservation']);
const STATUS_OFICINA    = new Set(['oficina','active_oficina']);
const STATUS_RESCHEDULED = new Set(['rescheduled','reagendado','reagendada','reprogramado','reprogramada']);

function normalizeStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'pending';
  if (STATUS_COMPLETED.has(s))   return 'completed';
  if (STATUS_PENDING.has(s))     return 'pending';
  if (STATUS_CANCELLED.has(s))   return 'cancelled';
  if (STATUS_HOLD.has(s))        return 'hold';
  if (STATUS_RESERVA.has(s))     return 'reserva';
  if (STATUS_OFICINA.has(s))     return 'oficina';
  if (STATUS_RESCHEDULED.has(s)) return 'rescheduled';
  if (s.includes('cancel'))                                        return 'cancelled';
  if (s.includes('pend'))                                          return 'pending';
  if (s.includes('complet') || s.includes('activ') ||
      s.includes('cerr')    || s.includes('vend'))                 return 'completed';
  if (s.includes('hold'))                                          return 'hold';
  if (s.includes('reser'))                                         return 'reserva';
  if (s.includes('resched') || s.includes('reagend') ||
      s.includes('reprogram'))                                     return 'rescheduled';
  if (s.includes('oficina'))                                       return 'oficina';
  return 'pending';
}

const isCompleted   = (s) => normalizeStatus(s) === 'completed';
const isCancelled   = (s) => normalizeStatus(s) === 'cancelled';
const isPending     = (s) => normalizeStatus(s) === 'pending';
const isReserva     = (s) => normalizeStatus(s) === 'reserva';
const isOficina     = (s) => normalizeStatus(s) === 'oficina';

const COMPLETED_VALUES_LOWER = ['completed','active','completado','activo','activa','vendido','cerrado','cerrada'];
const completedMatchExpr = { $in: [{ $toLower: { $ifNull: ['$status',''] } }, COMPLETED_VALUES_LOWER] };

function isColchon(lead, referenceDate) {
  try {
    const dv = String(lead.dia_venta       || lead.diaVenta       || '').slice(0, 7);
    const di = String(lead.dia_instalacion || lead.diaInstalacion || '').slice(0, 7);
    if (!dv || !di) return false;
    if (referenceDate) {
      const curYear  = referenceDate.getFullYear();
      const curMonth = String(referenceDate.getMonth() + 1).padStart(2, '0');
      return dv !== `${curYear}-${curMonth}` && di === `${curYear}-${curMonth}`;
    }
    return dv < di;
  } catch { return false; }
}

const isColchonActivo = (lead, referenceDate) =>
  isColchon(lead, referenceDate) && isCompleted(lead.status);

module.exports = {
  normalizeStatus,
  isCompleted, isCancelled, isPending, isReserva, isOficina,
  isColchon, isColchonActivo,
  COMPLETED_VALUES_LOWER, completedMatchExpr,
};
