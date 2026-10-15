import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
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

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function EmployeeModeView() {
  const { prefs } = useShell();
  return <EmployeeDetail key={prefs.employeeId ?? 0} memberId={prefs.employeeId} readOnly />;
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <AppShell employeeView={<EmployeeModeView />}>
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
        </AppShell>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
