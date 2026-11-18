import {Navigate, Route, Routes} from 'react-router-dom';
import {AppShell} from '@/components/layout/AppShell';
import {ForgotPasswordPage} from '@/features/auth/ForgotPasswordPage';
import {GuestOnly, RequireAuth} from '@/features/auth/guards';
import {LoginPage} from '@/features/auth/LoginPage';
import {ResetPasswordPage} from '@/features/auth/ResetPasswordPage';
import {SignupPage} from '@/features/auth/SignupPage';
import {VerifyEmailPage} from '@/features/auth/VerifyEmailPage';
import {DashboardPage} from '@/features/dashboard/DashboardPage';
import {ComingSoon, NotFound} from '@/features/misc/ComingSoon';
import {ProjectsPage} from '@/features/projects/ProjectsPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />

      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot" element={<ForgotPasswordPage />} />
      </Route>

      {/* Open to everyone: these are reached from email links, signed in or not. */}
      <Route path="/verify" element={<VerifyEmailPage />} />
      <Route path="/reset" element={<ResetPasswordPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/app" element={<DashboardPage />} />
          <Route path="/app/projects" element={<ProjectsPage />} />
          <Route path="/app/new" element={<ComingSoon title="New Reel" milestone="F5" />} />
          <Route path="/app/p/:id/script" element={<ComingSoon title="Script editor" milestone="F5" />} />
          <Route path="/app/p/:id/edit" element={<ComingSoon title="Reel editor" milestone="F6" />} />
          <Route path="/app/p/:id/render" element={<ComingSoon title="Render" milestone="F7" />} />
          <Route path="/app/p/:id/publish" element={<ComingSoon title="Publish" milestone="F7" />} />
          <Route path="/app/settings" element={<ComingSoon title="Settings" milestone="F8" />} />
          <Route path="/admin" element={<ComingSoon title="Admin" milestone="F8" />} />
          <Route path="/onboarding" element={<ComingSoon title="Onboarding" milestone="F4" />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
