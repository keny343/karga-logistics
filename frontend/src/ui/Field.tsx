import { useId } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import './Field.css';

interface Comuns {
  readonly label: string;
  readonly error?: string;
  readonly hint?: string;
  /**
   * Hides the label visually, for a control inside a table cell whose column
   * header already names it. The label still exists for screen readers - the
   * control is never left unnamed.
   */
  readonly labelHidden?: boolean;
}

const Envolvente = ({
  label,
  error,
  hint,
  labelHidden,
  id,
  children,
}: Comuns & { readonly id: string; readonly children: ReactNode }) => (
  <div className="field" data-invalid={error !== undefined}>
    {/* A label, never a placeholder standing in for one: the placeholder
        disappears the moment someone types. */}
    <label className={labelHidden === true ? 'sr-only' : 'field__label'} htmlFor={id}>
      {label}
    </label>
    {children}
    {error !== undefined ? (
      <p className="field__error" id={`${id}-error`} role="alert">
        {error}
      </p>
    ) : hint !== undefined ? (
      <p className="field__hint" id={`${id}-hint`}>
        {hint}
      </p>
    ) : null}
  </div>
);

const descricao = (id: string, error?: string, hint?: string): string | undefined => {
  if (error !== undefined) return `${id}-error`;
  if (hint !== undefined) return `${id}-hint`;
  return undefined;
};

const extras = (error?: string, hint?: string, labelHidden?: boolean) => ({
  ...(error !== undefined ? { error } : {}),
  ...(hint !== undefined ? { hint } : {}),
  ...(labelHidden !== undefined ? { labelHidden } : {}),
});

type InputProps = Comuns & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'>;

export const Input = ({ label, error, hint, labelHidden, ...resto }: InputProps) => {
  const id = useId();
  return (
    <Envolvente label={label} id={id} {...extras(error, hint, labelHidden)}>
      <input
        id={id}
        className="field__control"
        aria-invalid={error !== undefined}
        aria-describedby={descricao(id, error, hint)}
        {...resto}
      />
    </Envolvente>
  );
};

type SelectProps = Comuns &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> & {
    readonly children: ReactNode;
  };

export const Select = ({ label, error, hint, labelHidden, children, ...resto }: SelectProps) => {
  const id = useId();
  return (
    <Envolvente label={label} id={id} {...extras(error, hint, labelHidden)}>
      <select
        id={id}
        className="field__control"
        aria-invalid={error !== undefined}
        aria-describedby={descricao(id, error, hint)}
        {...resto}
      >
        {children}
      </select>
    </Envolvente>
  );
};

type TextareaProps = Comuns & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'className'>;

export const Textarea = ({
  label,
  error,
  hint,
  labelHidden,
  rows = 3,
  ...resto
}: TextareaProps) => {
  const id = useId();
  return (
    <Envolvente label={label} id={id} {...extras(error, hint, labelHidden)}>
      <textarea
        id={id}
        rows={rows}
        className="field__control field__control--area"
        aria-invalid={error !== undefined}
        aria-describedby={descricao(id, error, hint)}
        {...resto}
      />
    </Envolvente>
  );
};
