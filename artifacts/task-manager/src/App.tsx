import { useEffect, useRef } from 'react';
import { ClerkProvider, useAuth, useClerk } from '@clerk/react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, Redirect, useLocation } from 'wouter';
import { getGetAuthStatusQueryKey, useGetAuthStatus } from '@workspace/api-client-react';
import { AppShell, useShell } from '@/components/app-shell';
import { EmployeeDetail } from '@/components/employee-detail';
import HomePage from '@/pages/home';
import EmployeesPage from '@/pages/employees';
import EmployeePage from '@/pages/employee-page';
import CardsPage from '@/pages/cards';
import CardDetailPage from '@/pages/card-detail';
import ServicesPage from '@/pages/services';
import { AuthLoadingPage, AuthSetupPage, clerkAppearance, SignInPage, SignUpPage } from '@/components/auth-pages';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

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

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const nextUserId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== nextUserId) {
        client.clear();
      }
      previousUserId.current = nextUserId;
    });
    return unsubscribe;
  }, [addListener, client]);

  return null;
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
                <Redirect to="/employees" replace />
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
  const { isLoaded, userId } = useAuth();
  const { signOut } = useClerk();
  const [location] = useLocation();
  const status = useGetAuthStatus({
    query: {
      queryKey: [...getGetAuthStatusQueryKey(), userId ?? 'anonymous'],
      enabled: isLoaded,
      refetchOnWindowFocus: true,
      staleTime: 0,
    },
  });

  const guestCanViewPath = location === '/' || /^\/employees(?:\/|$)/.test(location);
  if (!isLoaded || (status.isLoading && (userId !== null || !guestCanViewPath))) {
    return <AuthLoadingPage />;
  }

  const data = status.data;
  const authConfigured = Boolean(clerkPublishableKey && data?.authConfigured);
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
      <ClerkQueryClientCacheInvalidator />
      <AuthenticatedApplication />
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
      <QueryClientProvider client={queryClient}>
        {clerkPublishableKey ? <ClerkApplication /> : (
          <Switch>
            <Route path="/sign-in/*?"><AuthSetupPage /></Route>
            <Route path="/sign-up/*?"><SignUpPage available={false} /></Route>
            <Route><GuestApplication /></Route>
          </Switch>
        )}
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
