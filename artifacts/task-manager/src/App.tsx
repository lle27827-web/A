import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { getGetCurrentAccessQueryKey, useGetCurrentAccess } from '@workspace/api-client-react';
import { ArrowUpRight } from 'lucide-react';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import NotFound from '@/pages/not-found';
import AttendanceApp from '@/pages/attendance-app';

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
    colorPrimary: '#2d6959',
    colorForeground: '#233b35',
    colorMutedForeground: '#66736d',
    colorDanger: '#a83d38',
    colorBackground: '#ffffff',
    colorInput: '#f8f5ed',
    colorInputForeground: '#233b35',
    colorNeutral: '#d9d5ca',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.8rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fffdf8] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#233b35] font-bold tracking-tight',
    headerSubtitle: 'text-[#66736d]',
    socialButtonsBlockButtonText: 'text-[#233b35] font-semibold',
    formFieldLabel: 'text-[#233b35] font-semibold',
    footerActionLink: 'text-[#2d6959] font-semibold',
    footerActionText: 'text-[#66736d]',
    dividerText: 'text-[#66736d]',
    identityPreviewEditButton: 'text-[#2d6959]',
    formFieldSuccessText: 'text-[#2d6959]',
    alertText: 'text-[#7d332f]',
    logoBox: 'mb-2',
    logoImage: 'rounded-xl',
    socialButtonsBlockButton: 'border-[#d9d5ca] bg-[#fffdf8] hover:bg-[#f4f0e7]',
    formButtonPrimary: 'bg-[#2d6959] hover:bg-[#25574a] text-white shadow-none',
    formFieldInput: 'bg-[#f8f5ed] border-[#d9d5ca] text-[#233b35]',
    footerAction: 'border-t border-[#e4dfd4]',
    dividerLine: 'bg-[#d9d5ca]',
    alert: 'bg-[#fbefeb] border-[#e9c5bd]',
    otpCodeFieldInput: 'border-[#d9d5ca] bg-[#f8f5ed]',
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
  const accessQuery = useGetCurrentAccess({ query: { queryKey: getGetCurrentAccessQueryKey(), retry: false } });
  const ownerConfigured = accessQuery.data?.ownerConfigured === true;
  return (
    <AuthFrame>
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={ownerConfigured ? `${basePath}/sign-up` : undefined}
        appearance={{
          ...clerkAppearance,
          elements: { ...clerkAppearance.elements, footerAction: ownerConfigured ? clerkAppearance.elements.footerAction : 'hidden' },
        }}
      />
    </AuthFrame>
  );
}

function SignUpPage() {
  return (
    <AuthFrame>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthFrame>
  );
}

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="auth-frame">
      <Link href="/" className="auth-back" data-testid="link-back-home"><ArrowUpRight size={16} /> Về trang chấm công</Link>
      {children}
    </main>
  );
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
        signIn: { start: { title: 'Chào mừng trở lại', subtitle: 'Đăng nhập để quản lý thành viên và ca làm.' } },
        signUp: { start: { title: 'Tạo tài khoản chủ sở hữu', subtitle: 'Quản lý chấm công cho cả nhóm.' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkCacheInvalidator />
        <Switch>
          <Route path="/" component={AttendanceApp} />
          <Route path="/attendance" component={AttendanceApp} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route component={NotFound} />
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
