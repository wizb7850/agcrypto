import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { RequireAdmin, RequireMerchant, SessionProvider } from './auth/session';
import { Loading } from './components/ui';
import AdminLayout from './layouts/AdminLayout';
import MerchantLayout from './layouts/MerchantLayout';

// Chaque page est chargée à la demande (le navigateur ne télécharge que ce qu'il affiche)
const Login = lazy(() => import('./pages/auth/Login'));
const Signup = lazy(() => import('./pages/auth/Signup'));
const VerifyEmail = lazy(() => import('./pages/auth/VerifyEmail'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));
const Dashboard = lazy(() => import('./pages/merchant/Dashboard'));
const Invoices = lazy(() => import('./pages/merchant/Invoices'));
const Withdrawals = lazy(() => import('./pages/merchant/Withdrawals'));
const Verification = lazy(() => import('./pages/merchant/Verification'));
const Integration = lazy(() => import('./pages/merchant/Integration'));
const Settings = lazy(() => import('./pages/merchant/Settings'));
const AdminLogin = lazy(() => import('./pages/admin/Login'));
const Overview = lazy(() => import('./pages/admin/Overview'));
const Merchants = lazy(() => import('./pages/admin/Merchants'));
const MerchantDetail = lazy(() => import('./pages/admin/MerchantDetail'));
const KycQueue = lazy(() => import('./pages/admin/KycQueue'));
const KycReview = lazy(() => import('./pages/admin/KycReview'));
const AdminWithdrawals = lazy(() => import('./pages/admin/Withdrawals'));
const AuditLog = lazy(() => import('./pages/admin/AuditLog'));
const Team = lazy(() => import('./pages/admin/Team'));

function NotFound() {
  return (
    <div className="loading" style={{ minHeight: '100vh' }}>
      <div className="stack" style={{ textAlign: 'center' }}>
        <h1>Page introuvable</h1>
        <Link to="/app">Retour au tableau de bord</Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Suspense fallback={<Loading full />}>
          <Routes>
            <Route path="/" element={<Navigate to="/app" replace />} />
            <Route path="/connexion" element={<Login />} />
            <Route path="/inscription" element={<Signup />} />
            <Route path="/verifier-email" element={<VerifyEmail />} />
            <Route path="/mot-de-passe-oublie" element={<ForgotPassword />} />
            <Route path="/reinitialiser-mot-de-passe" element={<ResetPassword />} />

            <Route element={<RequireMerchant />}>
              <Route path="/app" element={<MerchantLayout />}>
                <Route index element={<Dashboard />} />
                <Route path="factures" element={<Invoices />} />
                <Route path="retraits" element={<Withdrawals />} />
                <Route path="verification" element={<Verification />} />
                <Route path="integration" element={<Integration />} />
                <Route path="parametres" element={<Settings />} />
              </Route>
            </Route>

            <Route path="/admin/connexion" element={<AdminLogin />} />
            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Overview />} />
                <Route path="marchands" element={<Merchants />} />
                <Route path="marchands/:id" element={<MerchantDetail />} />
                <Route path="verifications" element={<KycQueue />} />
                <Route path="verifications/:id" element={<KycReview />} />
                <Route path="retraits" element={<AdminWithdrawals />} />
                <Route path="journal" element={<AuditLog />} />
                <Route path="equipe" element={<Team />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </SessionProvider>
    </BrowserRouter>
  );
}
