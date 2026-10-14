import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight, Hand, LoaderCircle, LockKeyhole } from 'lucide-react';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import NotFound from '@/pages/not-found';
import { AppShell, useShell } from '@/components/app-shell';
import { EmployeeDetail } from '@/components/employee-detail';
import HomePage from '@/pages/home';
import EmployeesPage from '@/pages/employees';
import EmployeePage from '@/pages/employee-page';
import CardsPage from '@/pages/cards';
import CardDetailPage from '@/pages/card-detail';
import ServicesPage from '@/pages/services';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#f8c93f',
    colorPrimaryForeground: '#0b0c0e',
    colorForeground: '#f8f7f4',
    colorMutedForeground: '#b9bcc2',
    colorMuted: '#1a1c20',
    colorDanger: '#f28b82',
    colorBackground: '#111317',
    colorInput: '#1a1c20',
    colorInputForeground: '#f8f7f4',
    colorNeutral: '#f8f7f4',
    colorBorder: '#30333a',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.8rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#111317] border border-[#30333a] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#f8f7f4] font-bold tracking-tight',
    headerSubtitle: 'text-[#b9bcc2]',
    socialButtonsBlockButtonText: 'text-[#f8f7f4] font-semibold',
    formFieldLabel: 'text-[#f8f7f4] font-semibold',
    footerActionLink: 'text-[#f8c93f] font-semibold',
    footerActionText: 'text-[#b9bcc2]',
    dividerText: 'text-[#b9bcc2]',
    identityPreviewEditButton: 'text-[#f8c93f]',
    formFieldSuccessText: 'text-[#8fe0b4]',
    alertText: 'text-[#f8f7f4]',
    logoBox: 'mb-2',
    logoImage: 'rounded-xl',
    socialButtonsBlockButton: 'border-[#30333a] bg-[#1a1c20] hover:bg-[#24272c] text-[#f8f7f4]',
    formButtonPrimary: 'bg-[#f8c93f] hover:bg-[#f0bb20] text-[#0b0c0e] shadow-none',
    formFieldInput: 'bg-[#1a1c20] border-[#30333a] text-[#f8f7f4]',
    footerAction: 'border-t border-[#30333a]',
    dividerLine: 'bg-[#30333a]',
    alert: 'bg-[#2a1715] border-[#7a3a34]',
    otpCodeFieldInput: 'border-[#30333a] bg-[#1a1c20] text-[#f8f7f4]',
    formFieldRow: 'gap-1.5',
    main: 'gap-5',
  },
};

function ClerkCacheInvalidator() {
  const { addListener } = useClerk();
  const cache = useQueryClient();
  const previousUser = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUser.current !== undefined && previousUser.current !== userId) cache.clear();
      previousUser.current = userId;
    });
    return unsubscribe;
  }, [addListener, cache]);
  return null;
}

function SignInPage() {
  return (
    <AuthFrame>
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        appearance={clerkAppearance}
      />
    </AuthFrame>
  );
}

function SignUpPage() {
  return (
    <AuthFrame>
      <SignUp appearance={clerkAppearance} routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthFrame>
  );
}

function AuthFrame({ children }: { children: ReactNode }) {
  const [, navigate] = useLocation();
  return (
    <main className="auth-frame">
      <nav className="auth-navigation" aria-label="Điều hướng đăng nhập">
        <Link href="/" className="btn ghost" data-testid="link-back-home"><ArrowUpRight size={16} /> Về trang chính</Link>
        <button type="button" className="btn ghost" onClick={() => window.history.length > 1 ? window.history.back() : navigate('/')} data-testid="button-auth-back"><ArrowLeft size={15} />Trở về</button>
      </nav>
      {children}
    </main>
  );
}

function EmployeeModeView() {
  const { prefs } = useShell();
  return <EmployeeDetail key={prefs.employeeId ?? 0} memberId={prefs.employeeId} readOnly />;
}

function LoginLanding() {
  return (
    <AuthFrame>
      <section className="auth-landing" aria-labelledby="auth-welcome-title">
        <span className="auth-brand-mark" aria-hidden="true"><Hand size={22} strokeWidth={2.4} /></span>
        <p className="auth-brand-name">SỔ CÔNG</p>
        <h1 id="auth-welcome-title">Đăng nhập để tiếp tục</h1>
        <p className="auth-landing-copy">
          Đăng nhập để xem dữ liệu nhân viên. Sau khi xác thực, hệ thống sẽ kiểm tra quyền truy cập và chỉ cho phép chủ sở hữu hoặc quản lý chỉnh sửa.
        </p>
        <Link href="/sign-in" className="btn primary auth-landing-action" data-testid="link-login-to-continue">
          Đăng nhập <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
        <Link href="/sign-up" className="auth-landing-secondary" data-testid="link-create-account">
          Tạo tài khoản
        </Link>
        <p className="auth-landing-note"><LockKeyhole size={14} aria-hidden="true" /> Dữ liệu chỉ tải sau khi đăng nhập.</p>
      </section>
    </AuthFrame>
  );
}

function AuthenticationLoading() {
  return (
    <AuthFrame>
      <section className="auth-landing" aria-busy="true" aria-live="polite">
        <LoaderCircle className="spin" size={24} aria-hidden="true" />
        <h1>Đang xác nhận đăng nhập</h1>
        <p className="auth-landing-copy">Vui lòng đợi trong giây lát.</p>
      </section>
    </AuthFrame>
  );
}

function AuthenticatedApp({ children, employeeView }: { children: ReactNode; employeeView: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <AuthenticationLoading />;
  if (!isSignedIn) return <LoginLanding />;
  return <AppShell employeeView={employeeView}>{children}</AppShell>;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'SỔ CÔNG · Chào mừng trở lại', subtitle: 'Đăng nhập để xem hồ sơ nhân viên; cần quyền quản lý để chỉnh sửa.' } },
        signUp: { start: { title: 'Tạo tài khoản SỔ CÔNG', subtitle: 'Tài khoản đã đăng nhập có thể xem nhân viên; cần quyền chủ sở hữu hoặc quản lý để chỉnh sửa.' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkCacheInvalidator />
        <Switch>
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route>
            <AuthenticatedApp employeeView={<EmployeeModeView />}>
              <Switch>
                <Route path="/" component={HomePage} />
                <Route path="/attendance" component={HomePage} />
                <Route path="/employees" component={EmployeesPage} />
                <Route path="/employees/:id" component={EmployeePage} />
                <Route path="/cards" component={CardsPage} />
                <Route path="/cards/:id" component={CardDetailPage} />
                <Route path="/services" component={ServicesPage} />
                <Route component={NotFound} />
              </Switch>
            </AuthenticatedApp>
          </Route>
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkRoutes />
    </WouterRouter>
  );
}

export default App;
