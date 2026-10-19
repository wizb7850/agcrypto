import { Link } from 'react-router';
import type { Limits } from '../api/types';
import { formatUsd } from '../lib/format';
import { Card, LevelBadge, Progress } from './ui';

const PERIOD: Record<string, string> = { total: 'au total', '30d': 'sur 30 jours', '24h': 'sur 24 heures' };

/** Limites d'encaissement et de retrait du compte, avec jauges. */
export function LimitsCard({ limits }: { limits: Limits }) {
  const { receive, withdraw } = limits;
  return (
    <Card title="Limites du compte" actions={<LevelBadge level={limits.level} />}>
      <div className="stack">
        <div className="stack-sm">
          <div className="row-between">
            <strong>Encaissement</strong>
            <span className="muted small">
              {receive.limit_usd === null ? 'Illimité' : `${formatUsd(receive.used_usd)} / ${formatUsd(receive.limit_usd)} ${PERIOD[receive.period ?? ''] ?? ''}`}
            </span>
          </div>
          {receive.limit_usd !== null && <Progress value={Number(receive.used_usd)} max={Number(receive.limit_usd)} />}
        </div>
        <div className="stack-sm">
          <div className="row-between">
            <strong>Retraits</strong>
            <span className="muted small">
              {!withdraw.allowed ? 'Vérification requise'
                : withdraw.limit_usd === null ? 'Illimité'
                  : `${formatUsd(withdraw.used_usd)} / ${formatUsd(withdraw.limit_usd)} ${PERIOD[withdraw.period ?? ''] ?? ''}`}
            </span>
          </div>
          {withdraw.allowed && withdraw.limit_usd !== null && <Progress value={Number(withdraw.used_usd)} max={Number(withdraw.limit_usd)} />}
        </div>
        {limits.level !== 'business' && (
          <p className="small muted">
            {limits.level === 'none' ? 'Vérifie ton compte pour retirer tes fonds.' : 'Le compte professionnel n\'a aucune limite.'}{' '}
            <Link to="/app/verification">{limits.level === 'none' ? 'Vérifier mon compte' : 'Passer en professionnel'} →</Link>
          </p>
        )}
      </div>
    </Card>
  );
}
