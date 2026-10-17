import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { ClerkProvider, useAuth, useClerk } from '@clerk/react';
import { viVN } from '@clerk/localizations';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, Redirect, useLocation, useSearch } from 'wouter';
import type { FacilityPermissions } from '@workspace/api-client-react';
import { getAuthStatus, getGetAuthStatusQueryKey, setAuthTokenGetter, useGetAuthStatus } from '@workspace/api-client-react';
import { ALL_PERMISSIONS, AppShell, NO_PERMISSIONS, hasFacilityAccess, useShell } from '@/components/app-shell';
import { EmployeeDetail } from '@/components/employee-detail';
import HomePage from '@/pages/home';
import EmployeesPage from '@/pages/employees';
import EmployeePage from '@/pages/employee-page';
import CardsPage from '@/pages/cards';
import CardDetailPage from '@/pages/card-detail';
import ServicesPage from '@/pages/services';
import PersonalPage from '@/pages/personal';
import AppointmentsPage from '@/pages/appointments';
import { AuthLoadingPage, AuthRestoreErrorPage, AuthSetupPage, clerkAppearance, NoFacilityAccessPage, SignInPage, SignUpPage, WelcomePage } from '@/components/auth-pages';
import { postAuthPath, retrySessionCheck, sessionScreen, validateRestoredSession } from '@/lib/auth-session';
import { createWebSessionTokenGetter } from '@/lib/web-session-token';

function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  });
}
const guestQueryClient = createAppQueryClient();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPublishableKey = import.meta.env.VITE_APP_CLERK_PUBLISHABLE_KEY?.trim();
const signInPath = `${basePath}/sign-in`;
const signUpPath = `${basePath}/sign-up`;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

function EmployeeModeView() {
  const { prefs } = useShell();
  return <EmployeeDetail key={prefs.employeeId ?? 0} memberId={prefs.employeeId} readOnly />;
}

function SessionApplication() {
  const { isLoaded, isSignedIn, userId, sessionId, getToken } = useAuth();
  const identity = isLoaded ? `${userId ?? 'anonymous'}:${sessionId ?? 'none'}` : 'loading';
  // Register before query effects run; cookies may be unavailable inside an
  // embedded preview even though Clerk has successfully established a session.
  useLayoutEffect(() => {
    let current = true;
    setAuthTokenGetter(isLoaded && isSignedIn
      ? createWebSessionTokenGetter(() => getToken(), window.location.origin, () => current)
      : null);
    return () => {
      current = false;
      setAuthTokenGetter(null);
    };
  }, [identity, isLoaded, isSignedIn, getToken]);
  // Each session has its own cache. Login/logout immediately unmounts the old
  // role application, so cached owner data cannot leak into a guest session.
  const client = useMemo(() => createAppQueryClient(), [identity]);
  useEffect(() => {
    return () => {
      void client.cancelQueries();
      client.clear();
    };
  }, [client]);
  if (!isLoaded) return <AuthLoadingPage />;
  return (
    <QueryClientProvider key={identity} client={client}>
      <AuthenticatedApplication />
    </QueryClientProvider>
  );
}

function SignedOutApplication({ authConfigured }: { authConfigured: boolean }) {
  return (
    <Switch>
      <Route path="/sign-in/*?"><SignInPage available={authConfigured} /></Route>
      <Route path="/sign-up/*?"><SignUpPage available={authConfigured} /></Route>
      <Route><WelcomePage /></Route>
    </Switch>
  );
}

function FacilityRoutes({ permissions }: { permissions: FacilityPermissions }) {
  const employees = permissions.allEmployees || permissions.employeeIds.length > 0;
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/attendance" component={HomePage} />
      {employees && <Route path="/employees" component={EmployeesPage} />}
      {employees && <Route path="/employees/:id" component={EmployeePage} />}
      {permissions.viewCards && <Route path="/cards" component={CardsPage} />}
      {permissions.viewCards && <Route path="/cards/:id" component={CardDetailPage} />}
      {permissions.editServices && <Route path="/services" component={ServicesPage} />}
      {(permissions.viewAppointments || permissions.editAppointments) && <Route path="/appointments" component={AppointmentsPage} />}
      <Route>
        <Redirect to="/" replace />
      </Route>
    </Switch>
  );
}

function SignedInApplication({
  isOwner,
  permissions,
  onSignOut,
}: {
  isOwner: boolean;
  permissions: FacilityPermissions;
  onSignOut: () => void;
}) {
  const search = useSearch();
  const signedInDestination = postAuthPath(search);
  const facility = hasFacilityAccess(permissions);
  return (
    <Switch>
      <Route path="/sign-in/*?"><Redirect to={signedInDestination} replace /></Route>
      <Route path="/sign-up/*?"><Redirect to={signedInDestination} replace /></Route>
      {/* Personal notebook: every signed-in account, independent of facility permissions. */}
      <Route path="/personal"><PersonalPage onSignOut={onSignOut} /></Route>
      <Route>
        {facility ? (
          <AppShell
            isOwner={isOwner}
            permissions={permissions}
            onSignOut={onSignOut}
            employeeView={<EmployeeModeView />}
          >
            <FacilityRoutes permissions={permissions} />
          </AppShell>
        ) : <NoFacilityAccessPage onSignOut={onSignOut} />}
      </Route>
    </Switch>
  );
}

function permissionKey(p: FacilityPermissions | undefined, owner: boolean): string {
  if (!p) return 'none';
  return JSON.stringify([owner, p.allEmployees, [...p.employeeIds].sort((a, b) => a - b), p.viewCards, p.viewRevenue, p.editEmployees, p.editCards, p.editServices, p.viewAppointments, p.editAppointments]);
}

function AuthenticatedApplication() {
  const { isLoaded, isSignedIn, sessionId } = useAuth();
  const { signOut } = useClerk();
  const client = useQueryClient();
  const status = useGetAuthStatus({
    query: {
      queryKey: [...getGetAuthStatusQueryKey(), sessionId ?? 'anonymous'],
      enabled: isLoaded && isSignedIn === true,
      queryFn: async ({ signal }) => validateRestoredSession(
        await getAuthStatus({ signal, credentials: 'same-origin', cache: 'no-store' }),
        isSignedIn === true,
      ),
      retry: retrySessionCheck,
      retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 2000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchInterval: 30_000,
      staleTime: 0,
    },
  });

  const data = status.data;
  const isOwner = data?.isOwner === true;
  const permissions = isOwner ? ALL_PERMISSIONS : data?.permissions ?? NO_PERMISSIONS;
  const key = data ? permissionKey(permissions, isOwner) : null;
  const lastKey = useRef<string | null>(null);
  // Effective rights changed (granted, narrowed, revoked): drop every cached
  // facility response so nothing fetched under the old scope stays visible.
  useLayoutEffect(() => {
    if (key === null) return;
    if (lastKey.current !== null && lastKey.current !== key) {
      const authKey = getGetAuthStatusQueryKey()[0];
      void client.resetQueries({
        predicate: (q) => {
          const head = q.queryKey[0];
          return !(typeof head === 'string' && (head === authKey || (head.startsWith('/api/personal') && head !== '/api/personal/comparison')));
        },
      });
    }
    lastKey.current = key;
  }, [key, client]);

  const screen = sessionScreen({
    loaded: isLoaded, signedIn: isSignedIn === true, pending: status.isPending,
    error: status.isError, publicPath: isSignedIn !== true,
  });
  if (screen === 'loading') {
    return <AuthLoadingPage />;
  }

  if (screen === 'error') {
    return <AuthRestoreErrorPage
      pending={status.isFetching}
      onRetry={() => { void status.refetch(); }}
      onSignIn={() => { void signOut({ redirectUrl: signInPath }); }}
    />;
  }

  if (isSignedIn !== true || data?.authenticated !== true) {
    return <SignedOutApplication authConfigured={Boolean(clerkPublishableKey)} />;
  }
  return (
    <SignedInApplication
      key={key}
      isOwner={isOwner}
      permissions={permissions}
      onSignOut={() => { void signOut({ redirectUrl: basePath || '/' }); }}
    />
  );
}

function ClerkApplication() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey!}
      appearance={clerkAppearance}
      signInUrl={signInPath}
      signUpUrl={signUpPath}
      signInFallbackRedirectUrl={basePath || '/'}
      signUpFallbackRedirectUrl={basePath || '/'}
      localization={{
        ...viVN,
        signIn: {
          ...(viVN.signIn ?? {}),
          start: { ...(viVN.signIn?.start ?? {}), title: 'Đăng nhập bằng email', subtitle: '' },
        },
        signUp: {
          ...(viVN.signUp ?? {}),
          start: { ...(viVN.signUp?.start ?? {}), title: 'Tạo tài khoản', subtitle: '' },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <SessionApplication />
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      {clerkPublishableKey ? <ClerkApplication /> : (
        <QueryClientProvider client={guestQueryClient}>
          <Switch>
            <Route path="/sign-in/*?"><AuthSetupPage /></Route>
            <Route path="/sign-up/*?"><AuthSetupPage /></Route>
            <Route><WelcomePage /></Route>
          </Switch>
        </QueryClientProvider>
      )}
    </WouterRouter>
  );
}

export default App;
