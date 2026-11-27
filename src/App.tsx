import {lazy, Suspense} from 'react';
import {Navigate, Route, Routes} from 'react-router-dom';
import {AppShell} from '@/components/layout/AppShell';
import {AdminPage} from '@/features/admin/AdminPage';
import {SettingsPage} from '@/features/settings/SettingsPage';
import {FullPageSpinner} from '@/components/ui/FullPageSpinner';
import {ForgotPasswordPage} from '@/features/auth/ForgotPasswordPage';
import {GuestOnly, OnboardingGate, RequireAuth} from '@/features/auth/guards';
import {LoginPage} from '@/features/auth/LoginPage';
import {ResetPasswordPage} from '@/features/auth/ResetPasswordPage';
import {SignupPage} from '@/features/auth/SignupPage';
import {VerifyEmailPage} from '@/features/auth/VerifyEmailPage';
import {DashboardPage} from '@/features/dashboard/DashboardPage';
import {NewReelPage} from '@/features/create/NewReelPage';
import {ScriptEditorPage} from '@/features/create/ScriptEditorPage';
import {ReelEditorPage} from '@/features/editor/ReelEditorPage';
import {NotFound} from '@/features/misc/ComingSoon';
import {OnboardingPage} from '@/features/onboarding/OnboardingPage';
import {PublishPage} from '@/features/publish/PublishPage';
import {RenderPage} from '@/features/publish/RenderPage';
import {ProjectsPage} from '@/features/projects/ProjectsPage';
import {USE_MOCKS} from '@/lib/env';

// Mock mode only: a stand-in for Instagram's approval screen. Not part of production builds' routes.
const MockInstagramPage = USE_MOCKS ? lazy(() => import('@/mocks/MockInstagramPage')) : null;
const MockYouTubePage = USE_MOCKS ? lazy(() => import('@/mocks/MockYouTubePage')) : null;

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
        <Route path="/onboarding" element={<OnboardingPage />} />
        {MockYouTubePage ? (
          <Route
            path="/mock/youtube"
            element={
              <Suspense fallback={<FullPageSpinner />}>
                <MockYouTubePage />
              </Suspense>
            }
          />
        ) : null}
        {MockInstagramPage ? (
          <Route
            path="/mock/instagram"
            element={
              <Suspense fallback={<FullPageSpinner />}>
                <MockInstagramPage />
              </Suspense>
            }
          />
        ) : null}

        <Route element={<OnboardingGate />}>
          <Route element={<AppShell />}>
            <Route path="/app" element={<DashboardPage />} />
            <Route path="/app/projects" element={<ProjectsPage />} />
            <Route path="/app/new" element={<NewReelPage />} />
            <Route path="/app/p/:id/script" element={<ScriptEditorPage />} />
            <Route path="/app/p/:id/edit" element={<ReelEditorPage />} />
            <Route path="/app/p/:id/render" element={<RenderPage />} />
            <Route path="/app/p/:id/publish" element={<PublishPage />} />
            <Route path="/app/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
