import type { Request, Response } from 'express';
import { CENTRO_LUANDA } from '../domain/geografia.js';
import { empresaDe } from '../middleware/authenticate.js';
import * as repo from '../repositories/map.repository.js';
import * as posicoes from '../repositories/positions.repository.js';
import { ambitoDe } from '../services/ambito.service.js';

/**
 * How old a position may be and still be drawn. Past this the driver may have
 * finished, gone home, or simply closed the tab that was reporting — and a stale
 * point drawn like a current one is a lie the map tells with a straight face.
 */
const FRESCURA_MINUTOS = 15;

/**
 * Everything the map draws, in one response: the open orders that have a point, the
 * pickup points they leave from, and the open orders that have no coordinates at
 * all.
 *
 * That last list is the reason this is not just the order list with a filter. A map
 * silently omitting three parcels is worse than a map that says so — the dispatcher
 * counts markers and believes them.
 */
export const operacao = async (req: Request, res: Response): Promise<void> => {
  const ambito = await ambitoDe(req.auth);

  if (ambito === 'vazio') {
    res.json({
      items: [],
      drivers: [],
      origins: [],
      withoutCoordinates: [],
      center: CENTRO_LUANDA,
      positionFreshnessMinutes: FRESCURA_MINUTOS,
    });
    return;
  }

  const escopo = { companyId: empresaDe(req), ...ambito };

  const [pontos, origens, semPonto, posicoesRecentes] = await Promise.all([
    repo.pontos(escopo),
    repo.origens(escopo),
    repo.semCoordenadas(escopo),
    // A driver sees his own last point; a customer sees none. Operators see the
    // fleet, which is the whole purpose of the screen.
    ambito.customerId !== undefined
      ? Promise.resolve([])
      : posicoes.recentes(escopo.companyId, FRESCURA_MINUTOS, ambito.driverId),
  ]);

  res.json({
    items: pontos.map(repo.paraDto),
    // Positions arrive on the socket from here on; this is the state of the fleet at
    // the moment the page opened, so a reconnect does not start from an empty map.
    drivers: posicoesRecentes.map(posicoes.paraDto),
    positionFreshnessMinutes: FRESCURA_MINUTOS,
    origins: origens.map((origem) => ({
      description: origem.description,
      municipality: origem.municipality,
      latitude: Number(origem.latitude),
      longitude: Number(origem.longitude),
    })),
    withoutCoordinates: semPonto.map(repo.semPontoParaDto),
    // Where to look when there is nothing to show. A map that opens on the middle
    // of the Atlantic looks broken rather than empty.
    center: CENTRO_LUANDA,
  });
};
