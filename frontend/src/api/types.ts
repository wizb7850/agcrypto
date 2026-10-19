// Types des réponses de l'API (voir la documentation Swagger du backend : /docs).

export type Level = 'none' | 'personal' | 'business';
export type AccountType = 'personal' | 'business';

export interface PublicInfo {
  api_base_url: string;
  demo: boolean;
  dev_mailbox_url: string | null;
  limits: { unverified_receive_usd: number; personal_receive_usd_30d: number; personal_withdraw_usd_24h: number };
  fees: { payment_percent: number; withdrawal_percent: number; withdrawal_fixed: Record<string, string> };
  price_currencies: string[];
  checkout_currencies: string[];
}

export interface MerchantMe {
  user: { id: string; email: string; email_verified: boolean };
  merchant: {
    id: string; name: string; account_type: AccountType; verification_level: Level;
    status: 'active' | 'suspended'; suspended_reason: string | null; created_at: string;
  };
}

export interface AdminMe { id: string; email: string; role: string; permissions: string[] }

export interface Balance { currency: string; available: string }

export interface Limits {
  level: Level;
  receive: { limit_usd: string | null; used_usd: string; remaining_usd: string | null; period: 'total' | '30d' | null };
  withdraw: { allowed: boolean; limit_usd: string | null; used_usd: string; remaining_usd: string | null; period: '24h' | null };
}

export interface Invoice {
  id: string; order_id: string; status: string; amount: string; currency: string; amount_usd: string | null;
  description: string | null; checkout_url: string; expires_at: string; created_at: string; updated_at: string;
}

export interface Payment {
  id: string; status: string; pay_currency: string | null; pay_amount: string | null; pay_address: string | null;
  pay_extra_id: string | null; actually_paid: string | null; expires_at: string | null;
}

export interface Withdrawal {
  id: string; merchant_id: string; merchant_name?: string; status: string; currency: string; amount: string;
  fee: string; net_amount: string; amount_usd: string | null; address: string; extra_id: string | null;
  tx_hash: string | null; reject_reason: string | null; created_at: string; processed_at: string | null;
}

export type List<K extends string, T> = { total: number } & Record<K, T[]>;

export interface Dashboard {
  balances: Balance[];
  limits: Limits;
  stats_30d: { volume_usd: string; paid_invoices: number; created_invoices: number; conversion_rate: number };
  pending_withdrawals: number;
  recent_invoices: Invoice[];
}

export interface Submission {
  id: string; level: 'personal' | 'business'; status: 'pending' | 'approved' | 'rejected';
  reject_reason: string | null; submitted_at: string; reviewed_at: string | null;
}

export interface VerificationStatus {
  account_type: AccountType;
  level: Level;
  latest_submission: Submission | null;
  requirements: Record<'personal' | 'business', { documents: string[]; optional_documents: string[]; note: string }>;
  document_kinds: Record<string, string>;
  limits: Limits;
}

export interface UploadedDocument { id: string; kind: string; label: string; file_name: string; mime_type: string; size: number }

export interface ApiKey { id: string; name: string | null; prefix: string; created_at: string; revoked_at: string | null }

export interface Settings {
  name: string; webhook_url: string | null; webhook_secret: string; price_currencies: string[]; checkout_currencies: string[];
  fees: PublicInfo['fees'];
}

export interface Quote { currency: string; amount: string; fee: string; net_amount: string }
export interface Revenue { currency: string; payment_fees: string; withdrawal_fees: string; total: string }

export interface AdminMerchant {
  id: string; name: string; email: string | null; account_type: AccountType; verification_level: Level;
  status: 'active' | 'suspended'; created_at: string;
}
