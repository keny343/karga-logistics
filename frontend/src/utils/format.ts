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
