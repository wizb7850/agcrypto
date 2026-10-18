# agcrypto

Passerelle de paiement crypto multi-marchands.
**v1 :** les paiements sont encaissés sur le compte NOWPayments de la plateforme ;
chaque marchand a un solde interne et demande des retraits, validés manuellement par l'admin.

## Fonctionnement

```
Marchand ──POST /v1/invoices──► agcrypto ──► NOWPayments (page de paiement)
Client paie ──► NOWPayments ──IPN signée──► agcrypto /ipn/nowpayments
                                              ├─ crédite le solde du marchand (moins la commission)
                                              └─ webhook signé ──► Marchand
Marchand ──POST /v1/withdrawals──► solde bloqué ──► Admin envoie les fonds ──► /admin/.../complete
```

Principes de conception :
- **Registre comptable** (`ledger_entries`) : le solde = somme des écritures, jamais une valeur modifiée à la main. Un paiement ne peut pas être crédité deux fois (contrainte d'unicité).
- **Montants en décimal exact** (`numeric` + `bigint`), jamais de float.
- **IPN vérifiées** (HMAC-SHA512), idempotentes, et tolérantes au désordre (un statut ne recule jamais).
- **Retraits** : le montant est bloqué dès la demande (verrou sur le marchand → pas de double dépense), recrédité si refus.
- **Webhooks marchands** via outbox : écrits dans la même transaction que le changement d'état, relances jusqu'à 24 h.

## Démarrage

```bash
cp .env.example .env          # renseigner les clés NOWPayments (sandbox d'abord)
docker compose up -d          # PostgreSQL
npm install
npm run db:migrate
npm run merchant:create -- "Ma boutique" https://boutique.com/webhooks/agcrypto
npm run dev
```

Dans le dashboard NOWPayments : générer la clé API et le **secret IPN**. En local, exposer l'API avec un tunnel
(`cloudflared tunnel --url http://localhost:3000`) et mettre l'URL dans `PUBLIC_BASE_URL`.

## API marchand (`Authorization: Bearer agc_...`)

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/v1/invoices` | Créer une facture `{amount:"49.99", currency:"EUR", order_id, description?, success_url?, cancel_url?, pay_currency?}` → `checkout_url` |
| GET | `/v1/invoices/:id` | Statut : `pending`, `confirming`, `partially_paid`, `paid`, `failed`, `expired`, `refunded` |
| GET | `/v1/balance` | Soldes disponibles par devise |
| POST | `/v1/withdrawals` | Demander un retrait `{currency, amount, address, extra_id?}` |
| GET | `/v1/withdrawals` | Historique des retraits |

Webhooks : en-tête `x-agcrypto-signature: t=<timestamp>,v1=<hmac>` où
`hmac = HMAC-SHA256(secret_webhook, "<timestamp>.<corps brut>")`. Le marchand doit vérifier la signature
et rejeter un timestamp trop ancien (> 5 min).

## Back-office (`Authorization: Bearer <ADMIN_TOKEN>`)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/admin/withdrawals?status=requested` | Retraits à traiter |
| POST | `/admin/withdrawals/:id/complete` | Après envoi des fonds : `{tx_hash}` |
| POST | `/admin/withdrawals/:id/reject` | Refuser et recréditer : `{reason}` |

## Tests

`npm test` : tests unitaires + parcours complet sur un vrai PostgreSQL en mémoire (PGlite), sans Docker.

## Prochaines étapes

1. Dashboard marchand (inscription, clés API, soldes, retraits).
2. Retraits automatiques via l'API Payouts de NOWPayments (+ validation d'adresse).
3. KYC des marchands, limites de retrait, double validation admin, journal d'audit.
4. Rate limiting, chiffrement des secrets (KMS), alerte de rapprochement (solde NOWPayments ≥ somme des soldes marchands).
5. Plus tard : connexion directe aux blockchains (même API marchand, nouveau fournisseur).
