import { useEffect, useMemo } from 'react';
import { ClerkProvider, useAuth, useClerk } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, Redirect, useLocation, useSearch } from 'wouter';
import { getAuthStatus, getGetAuthStatusQueryKey, useGetAuthStatus } from '@workspace/api-client-react';
import { AppShell, useShell } from '@/components/app-shell';
import { EmployeeDetail } from '@/components/employee-detail';
import HomePage from '@/pages/home';
import EmployeesPage from '@/pages/employees';
import EmployeePage from '@/pages/employee-page';
import CardsPage from '@/pages/cards';
import CardDetailPage from '@/pages/card-detail';
import ServicesPage from '@/pages/services';
import { AuthLoadingPage, AuthRestoreErrorPage, AuthSetupPage, clerkAppearance, SignInPage, SignUpPage } from '@/components/auth-pages';
import { retrySessionCheck, validateRestoredSession } from '@/lib/auth-session';

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

function GuestEmployeesRedirect() {
  const search = useSearch();
  const month = new URLSearchParams(search).get('month');
  const date = new URLSearchParams(search).get('date');
  const qs = new URLSearchParams();
  if (month) qs.set('month', month);
  if (date) qs.set('date', date);
  const s = qs.toString();
  return <Redirect to={s ? `/employees?${s}` : '/employees'} replace />;
}

function SessionApplication() {
  const { isLoaded, userId, sessionId } = useAuth();
  const identity = isLoaded ? `${userId ?? 'anonymous'}:${sessionId ?? 'none'}` : 'loading';
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

function RoleApplication({
  isOwner,
  authenticated,
  authConfigured,
  authStatusMessage,
  onSignOut,
}: {
  isOwner: boolean;
  authenticated: boolean;
  authConfigured: boolean;
  authStatusMessage?: string;
  onSignOut?: () => void;
}) {
  return (
    <Switch>
      <Route path="/sign-in/*?">
        <SignInPage available={authConfigured} />
      </Route>
      <Route path="/sign-up/*?">
        <SignUpPage available={authConfigured} />
      </Route>
      <Route>
        <AppShell
          isOwner={isOwner}
          authenticated={authenticated}
          authConfigured={authConfigured}
          authStatusMessage={authStatusMessage}
          onSignOut={onSignOut}
          employeeView={<EmployeeModeView />}
        >
          {isOwner ? (
            <Switch>
              <Route path="/" component={HomePage} />
              <Route path="/attendance" component={HomePage} />
              <Route path="/employees" component={EmployeesPage} />
              <Route path="/employees/:id" component={EmployeePage} />
              <Route path="/cards" component={CardsPage} />
              <Route path="/cards/:id" component={CardDetailPage} />
              <Route path="/services" component={ServicesPage} />
              <Route>
                <Redirect to="/" replace />
              </Route>
            </Switch>
          ) : (
            <Switch>
              <Route path="/employees" component={EmployeesPage} />
              <Route path="/employees/:id" component={EmployeePage} />
              <Route path="/">
                <GuestEmployeesRedirect />
              </Route>
              <Route>
                <Redirect to="/employees" replace />
              </Route>
            </Switch>
          )}
        </AppShell>
      </Route>
    </Switch>
  );
}

function AuthenticatedApplication() {
  const { isLoaded, isSignedIn, sessionId } = useAuth();
  const { signOut } = useClerk();
  const [location] = useLocation();
  const status = useGetAuthStatus({
    query: {
      queryKey: [...getGetAuthStatusQueryKey(), sessionId ?? 'anonymous'],
      enabled: isLoaded,
      queryFn: async ({ signal }) => validateRestoredSession(
        await getAuthStatus({ signal, credentials: 'same-origin', cache: 'no-store' }),
        isSignedIn === true,
      ),
      retry: retrySessionCheck,
      retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 2000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: 0,
    },
  });

  const guestCanViewPath = location === '/' || /^\/employees(?:\/|$)/.test(location);
  if (!isLoaded || (status.isPending && (isSignedIn || !guestCanViewPath))) {
    return <AuthLoadingPage />;
  }

  const isAuthPath = /^\/sign-(?:in|up)(?:\/|$)/.test(location);
  if (isSignedIn && status.isError && !isAuthPath) {
    return <AuthRestoreErrorPage
      pending={status.isFetching}
      onRetry={() => { void status.refetch(); }}
      onSignIn={() => { void signOut({ redirectUrl: signInPath }); }}
    />;
  }

  const data = status.data;
  const authConfigured = Boolean(clerkPublishableKey && (data?.authConfigured || status.isError));
  return (
    <RoleApplication
      isOwner={data?.isOwner === true}
      authenticated={data?.authenticated === true}
      authConfigured={authConfigured}
      authStatusMessage={status.isError ? 'Không thể xác minh quyền chủ sở hữu; ứng dụng đang ở chế độ chỉ xem.' : undefined}
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
      localization={{
        signIn: { start: { title: 'Đăng nhập chủ sở hữu', subtitle: 'Đăng nhập để quản lý toàn bộ dữ liệu cơ sở.' } },
        signUp: { start: { title: 'Tạo tài khoản', subtitle: 'Đăng ký bằng email để tiếp tục.' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <SessionApplication />
    </ClerkProvider>
  );
}

function GuestApplication() {
  return (
    <RoleApplication
      isOwner={false}
      authenticated={false}
      authConfigured={false}
    />
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      {clerkPublishableKey ? <ClerkApplication /> : (
        <QueryClientProvider client={guestQueryClient}>
          <Switch>
            <Route path="/sign-in/*?"><AuthSetupPage /></Route>
            <Route path="/sign-up/*?"><SignUpPage available={false} /></Route>
            <Route><GuestApplication /></Route>
          </Switch>
        </QueryClientProvider>
      )}
    </WouterRouter>
  );
}

export default App;
