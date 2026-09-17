/**
 * CSV for spreadsheets, not for other programs.
 *
 * Two things are deliberate here. The separator is `;` and the byte-order mark is
 * present, because Excel on a Portuguese locale reads a comma-separated file as a
 * single column; and any field that starts with `=`, `+`, `-`, `@`, tab or carriage
 * return is prefixed with an apostrophe, because Excel would otherwise treat it as
 * a formula. A customer named `=1+1` is a typo, but `=HYPERLINK(...)` in a customer
 * name is an attack on whoever opens the export, and the value we store came from a
 * form somebody else filled in.
 */

const PERIGOSO = /^[=+\-@\t\r]/;

export const campo = (valor: string | number | null | undefined): string => {
  if (valor === null || valor === undefined) return '';

  const texto = String(valor);
  const neutralizado = PERIGOSO.test(texto) ? `'${texto}` : texto;

  // Quote whenever the value could otherwise break the row apart. Inner quotes are
  // doubled, which is the whole of the escaping rule in RFC 4180.
  return /[";\n\r]/.test(neutralizado) ? `"${neutralizado.replace(/"/g, '""')}"` : neutralizado;
};

type Celula = string | number | null | undefined;

export const linha = (valores: readonly Celula[]): string => valores.map(campo).join(';');

/** A BOM so Excel detects UTF-8, and CRLF line endings for the same reason. */
export const documento = (
  cabecalho: readonly string[],
  linhas: readonly (readonly Celula[])[],
): string => `\uFEFF${[linha(cabecalho), ...linhas.map(linha)].join('\r\n')}\r\n`;
