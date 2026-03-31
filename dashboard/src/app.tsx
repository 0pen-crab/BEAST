import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { ProtectedRoute } from '@/components/protected-route';
import { LoginPage } from '@/pages/login';
import { SetupPage } from '@/pages/setup';
import { AppLayout } from '@/components/layout/app-layout';
import { DashboardPage } from '@/pages/dashboard';
import { TeamsPage } from '@/pages/teams';
import { TeamDetailPage } from '@/pages/team-detail';
import { ReposPage } from '@/pages/repos';
import { RepoPage } from '@/pages/repo';
import { FindingsPage } from '@/pages/findings';
import { FindingDetailPage } from '@/pages/finding-detail';
import { ScansPage } from '@/pages/scans';
import { EventsPage } from '@/pages/events';
import { ContributorsPage } from '@/pages/contributors';
import { ContributorProfilePage } from '@/pages/contributor-profile';
import { NotFoundPage } from '@/pages/not-found';
import { SettingsPage } from '@/pages/settings';
import { MembersPage } from '@/pages/members';
import { AdminLayout } from '@/pages/admin/layout';
import { AdminUsersPage } from '@/pages/admin/users';
import { AdminWorkspacesPage } from '@/pages/admin/workspaces';
import { NewWorkspacePage } from '@/pages/onboarding';
import { DemoIndexPage } from '@/pages/demo/index';
import { Demo1EyeGlow } from '@/pages/demo/demo-1-eye-glow';
import { Demo2EyeTracking } from '@/pages/demo/demo-2-eye-tracking';
import { Demo3VerticalDrift } from '@/pages/demo/demo-3-vertical-drift';
import { Demo4MicroShake } from '@/pages/demo/demo-4-micro-shake';
import { Demo5Tilt } from '@/pages/demo/demo-5-tilt';
import { Demo6ShadowBreathe } from '@/pages/demo/demo-6-shadow-breathe';
import { Demo7VignettePulse } from '@/pages/demo/demo-7-vignette-pulse';
import { Demo8FilmGrain } from '@/pages/demo/demo-8-film-grain';
import { Demo9Chromatic } from '@/pages/demo/demo-9-chromatic';
import { Demo10RedFlash } from '@/pages/demo/demo-10-red-flash';
import { Demo11Embers } from '@/pages/demo/demo-11-embers';
import { PipelineTestPage } from '@/pages/pipeline-test';
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="teams" element={<TeamsPage />} />
            <Route path="teams/:id" element={<TeamDetailPage />} />
            <Route path="scans" element={<ScansPage />} />
            <Route path="events" element={<EventsPage />} />
            <Route path="findings" element={<FindingsPage />} />
            <Route path="repos" element={<ReposPage />} />
            <Route path="repos/:id" element={<RepoPage />} />
            <Route path="contributors" element={<ContributorsPage />} />
            <Route path="contributors/:id" element={<ContributorProfilePage />} />
            <Route path="findings/:id" element={<FindingDetailPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="onboarding/*" element={<NewWorkspacePage />} />
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/workspaces" replace />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="workspaces" element={<AdminWorkspacesPage />} />
          </Route>
        </Route>
        <Route path="demo" element={<DemoIndexPage />} />
        <Route path="demo/1" element={<Demo1EyeGlow />} />
        <Route path="demo/2" element={<Demo2EyeTracking />} />
        <Route path="demo/3" element={<Demo3VerticalDrift />} />
        <Route path="demo/4" element={<Demo4MicroShake />} />
        <Route path="demo/5" element={<Demo5Tilt />} />
        <Route path="demo/6" element={<Demo6ShadowBreathe />} />
        <Route path="demo/7" element={<Demo7VignettePulse />} />
        <Route path="demo/8" element={<Demo8FilmGrain />} />
        <Route path="demo/9" element={<Demo9Chromatic />} />
        <Route path="demo/10" element={<Demo10RedFlash />} />
        <Route path="demo/11" element={<Demo11Embers />} />
        <Route path="pipeline-test" element={<PipelineTestPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
