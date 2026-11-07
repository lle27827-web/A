import { CalendarDays, CreditCard, Hand, Home, Menu, Search, Sparkles, Users } from "lucide-react";
import "./_group.css";

const navigation = [
  { label: "Trang chính", icon: Home, active: true },
  { label: "Quản lý nhân viên", icon: Users },
  { label: "Quản lý thẻ", icon: CreditCard },
  { label: "Lịch hẹn và trạng thái", icon: CalendarDays },
  { label: "Dịch vụ & giá", icon: Sparkles },
];

const shortcuts = [
  { label: "Quản lý nhân viên", detail: "Hồ sơ, chấm công và tiền công", icon: Users },
  { label: "Quản lý thẻ", detail: "Thẻ khách hàng và lịch sử sử dụng", icon: CreditCard },
  { label: "Lịch hẹn và trạng thái", detail: "Lịch khách và hoạt động nhân viên", icon: CalendarDays },
  { label: "Dịch vụ & giá", detail: "Danh mục dịch vụ và mức giá", icon: Sparkles },
];

function ServiceRows({ values }: { values: [string, string, string][] }) {
  return <ul className="service-duration-list" aria-label="Ca dịch vụ theo loại hình">{values.map(([name, count, hours]) => (
    <li key={name}><strong>{name}</strong><span>{count} ca</span><span>{hours}</span></li>
  ))}</ul>;
}

function RevenueCard({ period, revenue, net, cards, services, day = false }: {
  period: string; revenue: string; net: string; cards: string; services: [string, string, string][]; day?: boolean;
}) {
  return (
    <section className="revenue-period-card" aria-label={`Tổng doanh thu ${period.toLowerCase()}`}>
      <div className="revenue-period-primary-row">
        <h2 className="rev-label rev-label-key">{period}</h2>
        <p className="rev-value mono">{revenue}</p>
      </div>
      <div className="revenue-period-key-metrics">
        <div className="net-revenue-row"><span>Tổng doanh thu đã khấu trừ {day ? "ngày" : "tháng"}</span><strong>{net}</strong></div>
        <div className="revenue-card-row"><span>Doanh thu bán và nạp thẻ {day ? "ngày" : "tháng"}</span><strong>{cards}</strong></div>
      </div>
      <div className="revenue-service-summary">
        <span>Ca dịch vụ {day ? "hôm nay" : "trong tháng"}</span>
        <ServiceRows values={services} />
      </div>
      <details className="revenue-details">
        <summary><span className="revenue-details-closed">Xem chi tiết</span><span className="revenue-details-open">Ẩn chi tiết</span></summary>
        <dl className="rev-breakdown">
          <div><dt>Tiền mặt</dt><dd>18.420.000 ₫</dd></div>
          <div><dt>Chuyển khoản</dt><dd>14.030.000 ₫</dd></div>
          <div><dt>Khách lẻ và khách thẻ</dt><dd>74 · 42 lượt</dd></div>
        </dl>
      </details>
    </section>
  );
}

/* Static visual extraction of the existing AppShell + HomePage desktop view.
   Routing, auth and API data are represented by local sample data. */
export function Current() {
  return (
    <div className="desktop-preview app current-extract">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#"><span className="brand-mark"><Hand size={15} /></span><span>SỔ CÔNG</span></a>
          <label className="search"><Search size={16} /><span>Tìm nhân viên, khách, số điện thoại, dịch vụ...</span></label>
          <div className="account"><span className="mode-pill">Chủ sở hữu</span><button className="gear-btn" type="button" aria-label="Cài đặt"><Menu size={18} /></button></div>
        </div>
      </header>
      <aside className="desktop-rail" aria-label="Điều hướng chính">
        <nav className="desktop-rail-nav">
          {navigation.map(({ label, icon: Icon, active }) => (
            <a className="desktop-nav-link" aria-current={active ? "page" : undefined} href="#" key={label}>
              <Icon size={17} aria-hidden="true" /><span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="desktop-rail-bottom"><a className="desktop-nav-link personal-nav-link" href="#"><Hand size={17} />Chấm công cá nhân</a></div>
      </aside>
      <main className="main" id="main">
        <div className="home home-with-revenue">
          <nav className="tiles" aria-label="Chức năng cơ sở">
            {shortcuts.map(({ label, detail, icon: Icon }) => (
              <a href="#" className="tile" key={label}>
                <Icon size={28} aria-hidden="true" /><strong>{label}</strong>
                <span className="tile-kicker">{detail}</span><span className="tile-go">Mở <span aria-hidden="true">→</span></span>
              </a>
            ))}
          </nav>
          <section className="revenue" aria-labelledby="current-revenue-title">
            <div className="revenue-summary">
              <div className="current-revenue-heading">
                <p className="rev-label">DOANH THU CƠ SỞ</p><h1 id="current-revenue-title">Tổng doanh thu cơ sở</h1>
              </div>
              <RevenueCard period="Tổng doanh thu cơ sở tháng" revenue="32.450.000 ₫" net="25.870.000 ₫" cards="6.580.000 ₫"
                services={[["Đá nóng", "36", "42h 30m"], ["Trị liệu", "21", "27h"], ["Chăm sóc da", "18", "18h"]]} />
              <RevenueCard period="Tổng doanh thu hôm nay" revenue="1.250.000 ₫" net="980.000 ₫" cards="270.000 ₫"
                services={[["Đá nóng", "3", "3h 30m"], ["Trị liệu", "2", "2h"]]} day />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
