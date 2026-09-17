/**
 * Angolan conventions in one place: Kwanzas from integer cêntimos, dd/mm/yyyy
 * dates, and +244 phone numbers. Nothing formats money by hand.
 */

const MOEDA = new Intl.NumberFormat('pt-PT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Values arrive as integer cêntimos and are never divided before this point. */
export const formatKz = (centavos: number): string => `${MOEDA.format(centavos / 100)} Kz`;

export const formatKg = (gramas: number): string => {
  if (gramas < 1000) return `${gramas} g`;
  const kg = gramas / 1000;
  return `${kg.toLocaleString('pt-PT', { maximumFractionDigits: 2 })} kg`;
};

const DATA_HORA = new Intl.DateTimeFormat('pt-PT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const DATA = new Intl.DateTimeFormat('pt-PT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const HORA = new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit' });

export const formatDateTime = (iso: string): string => DATA_HORA.format(new Date(iso));
export const formatDate = (iso: string): string => DATA.format(new Date(iso));
export const formatTime = (iso: string): string => HORA.format(new Date(iso));

/** "Hoje 14:32" reads faster than a full date on a screen refreshed all day. */
export const formatQuando = (iso: string): string => {
  const data = new Date(iso);
  const hoje = new Date();
  const mesmoDia =
    data.getDate() === hoje.getDate() &&
    data.getMonth() === hoje.getMonth() &&
    data.getFullYear() === hoje.getFullYear();
  return mesmoDia ? `Hoje ${HORA.format(data)}` : DATA_HORA.format(data);
};

/**
 * How long ago, in the words somebody would use out loud. A live position is only
 * useful next to its age: "há 12 minutos" is the difference between a courier who is
 * moving and one whose phone stopped reporting.
 */
export const desdeQuando = (iso: string): string => {
  const segundos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));

  if (segundos < 45) return 'agora mesmo';
  if (segundos < 90) return 'há 1 minuto';

  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `há ${minutos} minutos`;

  const horas = Math.round(minutos / 60);
  if (horas < 24) return horas === 1 ? 'há 1 hora' : `há ${horas} horas`;

  return formatQuando(iso).toLowerCase();
};

/**
 * A duration in minutes as an operator says it: "2h 15" rather than "135 min".
 * Anything under an hour keeps the minutes, because that is the useful precision
 * for a delivery inside a city.
 */
export const formatDuracao = (minutos: number | null): string => {
  if (minutos === null) return '—';
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas}h` : `${horas}h ${String(resto).padStart(2, '0')}`;
};

/** A Luanda date in the `AAAA-MM-DD` form the report endpoints take. */
export const diaISO = (data: Date): string =>
  data.toLocaleDateString('en-CA', { timeZone: 'Africa/Luanda' });

/** Groups an Angolan mobile number: +244 923 456 789. */
export const formatTelefone = (bruto: string): string => {
  const digitos = bruto.replace(/\D/g, '');
  const nacional = digitos.startsWith('244') ? digitos.slice(3) : digitos;
  if (nacional.length !== 9) return bruto;
  return `+244 ${nacional.slice(0, 3)} ${nacional.slice(3, 6)} ${nacional.slice(6)}`;
};

export const iniciais = (nome: string): string =>
  nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? '')
    .join('');
