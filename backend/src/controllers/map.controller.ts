import type { Request, Response } from 'express';
import { CENTRO_LUANDA } from '../domain/geografia.js';
import { empresaDe } from '../middleware/authenticate.js';
import * as repo from '../repositories/map.repository.js';
import { ambitoDe } from '../services/ambito.service.js';

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
    res.json({ items: [], origins: [], withoutCoordinates: [], center: CENTRO_LUANDA });
    return;
  }

  const escopo = { companyId: empresaDe(req), ...ambito };

  const [pontos, origens, semPonto] = await Promise.all([
    repo.pontos(escopo),
    repo.origens(escopo),
    repo.semCoordenadas(escopo),
  ]);

  res.json({
    items: pontos.map(repo.paraDto),
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
