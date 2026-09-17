import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Tone } from '../domain/orderStatus';
import './LeafletMap.css';

export interface MarcadorMapa {
  readonly id: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly tone: Tone;
  /** Short text on the pin — an order code reads better than a number. */
  readonly label: string;
  /** Trusted HTML for the popup. Built by the caller from escaped values. */
  readonly popup: string;
  readonly kind?: 'destino' | 'origem';
}

interface Props {
  readonly marcadores: readonly MarcadorMapa[];
  readonly centro: { readonly latitude: number; readonly longitude: number };
  readonly zoom?: number;
  readonly height?: string;
  /** When set, clicking the map reports the point instead of doing nothing. */
  readonly onEscolherPonto?: (ponto: { latitude: number; longitude: number }) => void;
  readonly onAbrir?: (id: string) => void;
  readonly ariaLabel: string;
}

/**
 * Leaflet, driven directly rather than through a React wrapper.
 *
 * A wrapper library would be a second dependency that has to keep up with both
 * React and Leaflet, and what it buys is this file. Leaflet owns the DOM inside the
 * container; React owns the container and nothing below it, which is why the markers
 * are rebuilt in an effect instead of rendered as elements.
 *
 * Tiles come from OpenStreetMap, whose licence requires the attribution below — it
 * is not decoration and is not removed.
 */
export const LeafletMap = ({
  marcadores,
  centro,
  zoom = 11,
  height = '520px',
  onEscolherPonto,
  onAbrir,
  ariaLabel,
}: Props) => {
  const container = useRef<HTMLDivElement | null>(null);
  const mapa = useRef<L.Map | null>(null);
  const camada = useRef<L.LayerGroup | null>(null);
  /** How the map framed itself last, so a resize can restore the same view. */
  const enquadramento = useRef<(() => void) | null>(null);
  /** Set once the operator pans or zooms; after that the view is theirs. */
  const mexido = useRef(false);
  // Held in a ref so a new callback identity does not tear the map down.
  const escolher = useRef(onEscolherPonto);
  const abrir = useRef(onAbrir);
  escolher.current = onEscolherPonto;
  abrir.current = onAbrir;

  useEffect(() => {
    if (container.current === null || mapa.current !== null) return;

    const instancia = L.map(container.current, {
      center: [centro.latitude, centro.longitude],
      zoom,
      // A map inside a scrolling page must not swallow the wheel; ctrl+wheel and the
      // buttons still zoom.
      scrollWheelZoom: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(instancia);

    instancia.on('click', (evento: L.LeafletMouseEvent) => {
      escolher.current?.({ latitude: evento.latlng.lat, longitude: evento.latlng.lng });
    });

    // Leaflet lays tiles out from the container's size at creation time, so a
    // container that grows or shrinks afterwards — a phone rotating, the sidebar
    // drawer opening, the page reflowing — leaves the map showing the wrong area
    // with grey edges until it is told.
    const observador = new ResizeObserver(() => {
      instancia.invalidateSize({ animate: false });
      // The framing is only restored while the view is still the map's own choice.
      // Re-fitting after the operator has panned would drag them back mid-task.
      if (!mexido.current) enquadramento.current?.();
    });
    observador.observe(container.current);

    for (const evento of ['mousedown', 'wheel', 'touchstart'] as const) {
      container.current.addEventListener(
        evento,
        () => {
          mexido.current = true;
        },
        { passive: true },
      );
    }

    camada.current = L.layerGroup().addTo(instancia);
    mapa.current = instancia;

    return () => {
      observador.disconnect();
      instancia.remove();
      mapa.current = null;
      camada.current = null;
    };
    // Deliberately once: the map is a long-lived object, and re-creating it on every
    // prop change would throw the operator's pan and zoom away mid-task.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instancia = mapa.current;
    const grupo = camada.current;
    if (instancia === null || grupo === null) return;

    grupo.clearLayers();

    for (const marcador of marcadores) {
      const pino = L.marker([marcador.latitude, marcador.longitude], {
        icon: L.divIcon({
          className: 'pino',
          html: `<span class="pino__corpo" data-tone="${marcador.tone}" data-kind="${
            marcador.kind ?? 'destino'
          }">${marcador.label}</span>`,
          iconSize: [76, 24],
          iconAnchor: [38, 24],
        }),
        title: marcador.label,
        // Keyboard users tab through the markers and open a popup with Enter.
        keyboard: true,
      });

      pino.bindPopup(marcador.popup);
      if (abrir.current !== undefined) {
        // The popup is plain HTML outside React's tree, so its links are wired by
        // hand. Each one carries its own id, because a pin can stand for several
        // parcels at the same address. They stay real `href`s: middle-clicking one
        // to open a second order in a tab is something a dispatcher does.
        pino.on('popupopen', () => {
          const elemento = pino.getPopup()?.getElement();
          for (const ligacao of elemento?.querySelectorAll('[data-abrir]') ?? []) {
            ligacao.addEventListener('click', (evento) => {
              evento.preventDefault();
              const proprio = ligacao.getAttribute('data-abrir');
              abrir.current?.(proprio !== null && proprio !== '' ? proprio : marcador.id);
            });
          }
        });
      }

      pino.addTo(grupo);
    }

    // Frame what there is. With a single marker `fitBounds` would zoom to street
    // level, which hides the context an operator needs.
    const primeiro = marcadores[0];

    enquadramento.current =
      marcadores.length > 1
        ? () =>
            instancia.fitBounds(
              L.latLngBounds(marcadores.map((m) => [m.latitude, m.longitude] as [number, number])),
              { padding: [40, 40], maxZoom: 14 },
            )
        : primeiro !== undefined
          ? () => instancia.setView([primeiro.latitude, primeiro.longitude], 14)
          : null;

    enquadramento.current?.();
  }, [marcadores]);

  return (
    <div
      className="mapa"
      style={{ height }}
      ref={container}
      role="application"
      aria-label={ariaLabel}
    />
  );
};
