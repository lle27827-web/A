import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Hand,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import "./_group.css";

type Section = "overview" | "cards" | "employees" | "appointments" | "services";

const navigation: { id: Section; label: string; icon: typeof Users }[] = [
  { id: "employees", label: "Quản lý nhân viên", icon: Users },
  { id: "cards", label: "Quản lý thẻ", icon: CreditCard },
  { id: "appointments", label: "Lịch hẹn và trạng thái", icon: CalendarDays },
  { id: "services", label: "Dịch vụ & giá", icon: Sparkles },
];

const clientCards = [
  { name: "Nguyễn Ngọc Mai", phone: "0903 482 176", package: "Đá nóng · 10 buổi", balance: "6 buổi", amount: "3.600.000 ₫", date: "12/11/2026", initials: "NM", tone: "rose" },
  { name: "Trần Minh Anh", phone: "0918 225 403", package: "Chăm sóc da · 5 buổi", balance: "2 buổi", amount: "2.250.000 ₫", date: "10/11/2026", initials: "MA", tone: "green" },
  { name: "Lê Thu Hà", phone: "0987 610 542", package: "Massage trị liệu · 8 buổi", balance: "5 buổi", amount: "4.800.000 ₫", date: "08/11/2026", initials: "TH", tone: "blue" },
  { name: "Phạm Quỳnh Chi", phone: "0934 761 228", package: "Đá nóng · 5 buổi", balance: "1 buổi", amount: "1.900.000 ₫", date: "06/11/2026", initials: "QC", tone: "gold" },
  { name: "Đỗ Thanh Vân", phone: "0908 314 992", package: "Gội dưỡng sinh · 10 buổi", balance: "8 buổi", amount: "1.500.000 ₫", date: "04/11/2026", initials: "TV", tone: "rose" },
  { name: "Vũ Hoàng Yến", phone: "0971 253 608", package: "Chăm sóc da · 10 buổi", balance: "4 buổi", amount: "4.200.000 ₫", date: "01/11/2026", initials: "HY", tone: "green" },
  { name: "Bùi Lan Phương", phone: "0912 504 731", package: "Massage trị liệu · 5 buổi", balance: "3 buổi", amount: "2.800.000 ₫", date: "30/10/2026", initials: "LP", tone: "blue" },
];

const employeeRows = [
  { name: "Nguyễn Thị Hương", role: "Kỹ thuật viên", status: "Đang làm", initials: "NH" },
  { name: "Trần Thị Thảo", role: "Kỹ thuật viên", status: "Đang làm", initials: "TT" },
  { name: "Lê Minh Trang", role: "Lễ tân", status: "Đang làm", initials: "MT" },
  { name: "Phạm Thị Ngọc", role: "Kỹ thuật viên", status: "Nghỉ hôm nay", initials: "PN" },
];

const appointments = [
  { time: "09:00", client: "Nguyễn Ngọc Mai", service: "Đá nóng · 90 phút", staff: "Hương", status: "Đã xác nhận" },
  { time: "10:30", client: "Trần Minh Anh", service: "Chăm sóc da · 60 phút", staff: "Thảo", status: "Đang chờ" },
  { time: "13:00", client: "Lê Thu Hà", service: "Massage trị liệu · 90 phút", staff: "Ngọc", status: "Đã xác nhận" },
  { time: "15:30", client: "Vũ Hoàng Yến", service: "Gội dưỡng sinh · 45 phút", staff: "Hương", status: "Đã xác nhận" },
];

const services = [
  { name: "Massage đá nóng", duration: "90 phút", price: "650.000 ₫", group: "Massage" },
  { name: "Massage trị liệu", duration: "60 phút", price: "480.000 ₫", group: "Massage" },
  { name: "Chăm sóc da cơ bản", duration: "60 phút", price: "450.000 ₫", group: "Chăm sóc da" },
  { name: "Gội dưỡng sinh", duration: "45 phút", price: "180.000 ₫", group: "Thư giãn" },
];

function MoneyRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={strong ? "dt-money-row is-strong" : "dt-money-row"}><span>{label}</span><b>{value}</b></div>;
}

function RevenuePanel() {
  const [month, setMonth] = useState("Tháng 11, 2026");
  const [day, setDay] = useState("Hôm nay · 18/11");
  const [monthDetails, setMonthDetails] = useState(false);
  const [dayDetails, setDayDetails] = useState(false);
  return (
    <section className="dt-revenue-scroll" aria-label="Doanh thu cơ sở">
      <div className="dt-revenue-title">
        <div><span className="dt-eyebrow">TỔNG QUAN CƠ SỞ</span><h1>Doanh thu</h1></div>
        <span className="dt-live"><i /> Đang cập nhật</span>
      </div>
      <article className="dt-revenue-card">
        <header className="dt-revenue-card-head">
          <div><span className="dt-period-caption">DOANH THU THÁNG</span><b className="dt-total">32.450.000 <small>₫</small></b></div>
          <div className="dt-period-controls">
            <button aria-label="Tháng trước" onClick={() => setMonth("Tháng 10, 2026")}><ChevronLeft size={16} /></button>
            <span>{month}</span>
            <button aria-label="Tháng sau" onClick={() => setMonth("Tháng 11, 2026")}><ChevronRight size={16} /></button>
          </div>
        </header>
        <div className="dt-revenue-rows">
          <MoneyRow label="Tổng doanh thu đã khấu trừ tháng" value="25.870.000 ₫" strong />
          <MoneyRow label="Doanh thu bán và nạp thẻ tháng" value="6.580.000 ₫" />
        </div>
        <div className="dt-service-breakdown">
          <span>Ca dịch vụ trong tháng</span>
          <div><b>Đá nóng</b><span>36 ca · 42h 30m</span></div>
          <div><b>Trị liệu</b><span>21 ca · 27h</span></div>
          <div><b>Chăm sóc da</b><span>18 ca · 18h</span></div>
        </div>
        <button className="dt-detail-toggle" onClick={() => setMonthDetails(!monthDetails)}>
          {monthDetails ? "Ẩn chi tiết" : "Xem chi tiết"} <ChevronDown className={monthDetails ? "rotated" : ""} size={15} />
        </button>
        {monthDetails && <div className="dt-extra-details">
          <MoneyRow label="Tiền mặt tháng" value="18.420.000 ₫" />
          <MoneyRow label="Chuyển khoản tháng" value="14.030.000 ₫" />
          <MoneyRow label="Khách lẻ tháng" value="74 lượt" />
          <MoneyRow label="Khách thẻ tháng" value="42 lượt" />
          <MoneyRow label="Gói thẻ bán nhiều nhất" value="Đá nóng · 12 thẻ" />
          <MoneyRow label="Dịch vụ sử dụng nhiều nhất" value="Đá nóng · 36 lượt" />
        </div>}
      </article>

      <article className="dt-revenue-card dt-day-card">
        <header className="dt-revenue-card-head">
          <div><span className="dt-period-caption">DOANH THU NGÀY</span><b className="dt-total">1.250.000 <small>₫</small></b></div>
          <div className="dt-period-controls">
            <button aria-label="Ngày trước" onClick={() => setDay("17/11/2026")}><ChevronLeft size={16} /></button>
            <span>{day}</span>
            <button aria-label="Ngày sau" onClick={() => setDay("Hôm nay · 18/11")}><ChevronRight size={16} /></button>
          </div>
        </header>
        <div className="dt-revenue-rows">
          <MoneyRow label="Tổng doanh thu đã khấu trừ ngày" value="980.000 ₫" strong />
          <MoneyRow label="Doanh thu bán và nạp thẻ ngày" value="270.000 ₫" />
        </div>
        <div className="dt-service-breakdown">
          <span>Ca dịch vụ hôm nay</span>
          <div><b>Đá nóng</b><span>3 ca · 3h 30m</span></div>
          <div><b>Trị liệu</b><span>2 ca · 2h</span></div>
        </div>
        <button className="dt-detail-toggle" onClick={() => setDayDetails(!dayDetails)}>
          {dayDetails ? "Ẩn chi tiết" : "Xem chi tiết"} <ChevronDown className={dayDetails ? "rotated" : ""} size={15} />
        </button>
        {dayDetails && <div className="dt-extra-details">
          <MoneyRow label="Doanh thu khách lẻ" value="980.000 ₫" />
          <MoneyRow label="Tiền mặt hôm nay" value="750.000 ₫" />
          <MoneyRow label="Chuyển khoản hôm nay" value="500.000 ₫" />
          <MoneyRow label="Khách lẻ · khách thẻ" value="3 · 2 lượt" />
        </div>}
      </article>
      <div className="dt-revenue-footnote">Số liệu tổng hợp theo hoạt động của cơ sở</div>
    </section>
  );
}

export function DesktopTwoPane() {
  const [active, setActive] = useState<Section>("overview");
  const [search, setSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState(clientCards[0].name);
  const filteredCards = useMemo(() => clientCards.filter((item) =>
    `${item.name} ${item.phone} ${item.package}`.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi")),
  ), [search]);

  return (
    <div className="desktop-preview dt-shell">
      <header className="dt-topbar">
        <a className="dt-brand" href="#" aria-label="Sổ Công">
          <span className="dt-brand-mark"><Hand size={17} strokeWidth={2.4} /></span>
          <span>SỔ CÔNG</span>
        </a>
        <label className="dt-topbar-context dt-global-search">
          <Search size={16} aria-hidden="true" />
          <input aria-label="Tìm kiếm" placeholder="Tìm nhân viên, khách, số điện thoại, dịch vụ..." />
        </label>
        <div className="dt-topbar-right"><span className="dt-role">Chủ sở hữu</span><span className="dt-user-mark">AL</span></div>
      </header>
      <div className="dt-workspace">
        <aside className="dt-left-pane">
          <RevenuePanel />
        </aside>
        <section className="dt-right-pane">
          <div className="dt-function-bar">
            <div className="dt-function-label">CHỨC NĂNG CƠ SỞ</div>
            <nav className="dt-function-nav" aria-label="Chức năng cơ sở">
              {navigation.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" className={active === id ? "dt-function-link active" : "dt-function-link"}
                  aria-current={active === id ? "page" : undefined} onClick={() => setActive(id)}>
                  <Icon size={16} aria-hidden="true" /><span>{label}</span>
                </button>
              ))}
            </nav>
          </div>
          <main className="dt-page-scroll">
            {active === "overview" && <div className="dt-page-content">
              <div className="dt-page-heading">
                <div><p className="dt-eyebrow">TỔNG QUAN CƠ SỞ</p><h2>Chức năng cơ sở</h2><p className="dt-page-subtitle">Chọn một mục để quản lý và xem dữ liệu.</p></div>
              </div>
              <div className="dt-overview-grid">
                {navigation.map(({ id, label, icon: Icon }) => (
                  <button key={id} type="button" className="dt-overview-tile" onClick={() => setActive(id)}>
                    <Icon size={22} aria-hidden="true" /><strong>{label}</strong><span>Mở mục quản lý</span><ChevronRight size={16} className="dt-overview-arrow" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>}
            {active === "cards" && <div className="dt-page-content">
              <div className="dt-page-heading">
                <div><p className="dt-eyebrow">HỒ SƠ KHÁCH HÀNG</p><h2>Quản lý thẻ</h2><p className="dt-page-subtitle">Theo dõi thẻ dịch vụ và số buổi còn lại của khách.</p></div>
                <div className="dt-page-count"><b>126</b><span>thẻ khách hàng</span></div>
              </div>
              <div className="dt-list-toolbar">
                <label className="dt-list-search"><Search size={16} /><input aria-label="Tìm khách hàng" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm tên, số điện thoại hoặc dịch vụ..." /></label>
                <button type="button" className="dt-filter-button">Tất cả thẻ <ChevronDown size={15} /></button>
              </div>
              <div className="dt-card-list">
                <div className="dt-list-header"><span>KHÁCH HÀNG</span><span>GÓI DỊCH VỤ</span><span>CÒN LẠI</span><span>NGÀY MUA</span><span /></div>
                {filteredCards.map((card) => (
                  <button type="button" className={selectedClient === card.name ? "dt-client-row selected" : "dt-client-row"} key={card.phone} onClick={() => setSelectedClient(card.name)}>
                    <span className="dt-client-name"><i className={`dt-avatar ${card.tone}`}>{card.initials}</i><span><b>{card.name}</b><small>{card.phone}</small></span></span>
                    <span className="dt-package-cell"><b>{card.package.split(" · ")[0]}</b><small>{card.package.split(" · ")[1]} · {card.amount}</small></span>
                    <span className="dt-balance"><b>{card.balance}</b><small>còn lại</small></span>
                    <span className="dt-date">{card.date}</span>
                    <span className="dt-row-chevron"><ChevronRight size={17} /></span>
                  </button>
                ))}
                {!filteredCards.length && <div className="dt-no-results">Không tìm thấy thẻ phù hợp với “{search}”.</div>}
              </div>
              <div className="dt-list-footer"><span>Hiển thị {filteredCards.length} trong 126 thẻ</span><div><button disabled aria-label="Trang trước"><ChevronLeft size={16} /></button><b>1</b><button aria-label="Trang tiếp theo"><ChevronRight size={16} /></button></div></div>
              <div className="dt-selected-note"><span className="dt-note-mark"><CreditCard size={17} /></span><span><b>{selectedClient}</b><small>Chọn một hồ sơ để xem thông tin thẻ và lịch sử sử dụng.</small></span></div>
            </div>}
            {active === "employees" && <div className="dt-page-content">
              <div className="dt-page-heading"><div><p className="dt-eyebrow">ĐỘI NGŨ CƠ SỞ</p><h2>Quản lý nhân viên</h2><p className="dt-page-subtitle">Hồ sơ và tình trạng làm việc hôm nay.</p></div><div className="dt-page-count"><b>08</b><span>nhân viên</span></div></div>
              <div className="dt-list-toolbar"><label className="dt-list-search"><Search size={16} /><input aria-label="Tìm nhân viên" placeholder="Tìm tên nhân viên..." /></label></div>
              <div className="dt-simple-list">{employeeRows.map((person) => <div className="dt-simple-row" key={person.name}><i className="dt-avatar gold">{person.initials}</i><span className="dt-person-copy"><b>{person.name}</b><small>{person.role}</small></span><span className={person.status === "Đang làm" ? "dt-status" : "dt-status off"}><i />{person.status}</span><ChevronRight size={17} /></div>)}</div>
            </div>}
            {active === "appointments" && <div className="dt-page-content">
              <div className="dt-page-heading"><div><p className="dt-eyebrow">LỊCH KHÁCH HẸN</p><h2>Lịch hẹn và trạng thái</h2><p className="dt-page-subtitle">Lịch hẹn hôm nay · Thứ Tư, 18 tháng 11</p></div><div className="dt-page-count"><b>04</b><span>lịch hẹn hôm nay</span></div></div>
              <div className="dt-appointment-list">{appointments.map((item) => <div className="dt-appointment-row" key={item.time}><b className="dt-appt-time">{item.time}</b><div className="dt-appt-rule" /><span className="dt-appt-copy"><b>{item.client}</b><small>{item.service} · KTV {item.staff}</small></span><span className={item.status === "Đang chờ" ? "dt-appt-status wait" : "dt-appt-status"}>{item.status}</span><ChevronRight size={17} /></div>)}</div>
            </div>}
            {active === "services" && <div className="dt-page-content">
              <div className="dt-page-heading"><div><p className="dt-eyebrow">DANH MỤC CƠ SỞ</p><h2>Dịch vụ &amp; giá</h2><p className="dt-page-subtitle">Danh sách dịch vụ và mức giá đang áp dụng.</p></div><div className="dt-page-count"><b>12</b><span>dịch vụ</span></div></div>
              <div className="dt-list-toolbar"><label className="dt-list-search"><Search size={16} /><input aria-label="Tìm dịch vụ" placeholder="Tìm tên dịch vụ..." /></label><button type="button" className="dt-filter-button">Tất cả nhóm <ChevronDown size={15} /></button></div>
              <div className="dt-service-list">{services.map((service) => <div className="dt-service-row" key={service.name}><span className="dt-service-icon"><Sparkles size={17} /></span><span className="dt-person-copy"><b>{service.name}</b><small>{service.group} · {service.duration}</small></span><b className="dt-service-price">{service.price}</b><ChevronRight size={17} /></div>)}</div>
            </div>}
          </main>
        </section>
      </div>
      <style>{`
        .dt-shell{height:100vh;min-height:680px;overflow:hidden;display:flex;flex-direction:column;background:hsl(var(--background));}
        .dt-shell button,.dt-shell input{font:inherit}
        .dt-topbar{height:64px;flex:0 0 64px;display:flex;align-items:center;padding:0 28px;border-bottom:1px solid hsl(var(--border));background:hsl(46 76% 67%);gap:30px}
        .dt-brand{display:inline-flex;align-items:center;gap:9px;text-decoration:none;color:hsl(0 72% 34%);font-family:var(--app-font-display);font-weight:800;font-size:17px;letter-spacing:-.05em}
        .dt-brand-mark{width:31px;height:31px;display:grid;place-items:center;border-radius:10px 10px 10px 3px;color:hsl(0 0% 100%);background:hsl(0 72% 34%)}
        .dt-topbar-context{display:flex;align-items:center;gap:9px;font-size:12px;color:hsl(var(--foreground)/.72)}
        .dt-global-search{flex:1;max-width:620px;min-width:0;height:42px;padding:0 12px;border:1px solid hsl(var(--search-border));border-radius:10px;background:hsl(var(--search-background));color:hsl(var(--search-foreground))}
        .dt-global-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:hsl(var(--search-foreground));font:inherit}
        .dt-global-search input::placeholder{color:hsl(var(--search-foreground)/.72)}
        .dt-topbar-right{margin-left:auto;display:flex;align-items:center;gap:12px}
        .dt-role{padding:6px 10px;border-radius:99px;background:hsl(var(--primary));color:hsl(0 0% 100%);font-size:11px;font-weight:800}
        .dt-user-mark{display:grid;place-items:center;width:31px;height:31px;border-radius:50%;background:hsl(40 47% 91%);color:hsl(var(--foreground));font-size:11px;font-weight:800}
        .dt-workspace{display:grid;grid-template-columns:minmax(300px,34%) minmax(0,1fr);min-height:0;flex:1}
        .dt-left-pane{min-height:0;overflow-y:auto;overscroll-behavior:contain;border-right:1px solid hsl(var(--border));background:hsl(var(--background))}
        .dt-revenue-scroll{width:min(100%,470px);margin:0 auto;padding:25px 22px 24px}
        .dt-revenue-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:17px}
        .dt-eyebrow{display:block;margin:0 0 5px;color:hsl(var(--primary));font-size:9px;line-height:1.2;font-weight:800;letter-spacing:.14em}
        .dt-revenue-title h1{margin:0;font-family:var(--app-font-display);font-size:24px;letter-spacing:-.055em}
        .dt-live{display:flex;align-items:center;gap:6px;color:hsl(var(--muted-foreground));font-size:10px}
        .dt-live i{width:6px;height:6px;border-radius:50%;background:hsl(150 58% 30%)}
        .dt-revenue-card{margin-bottom:14px;padding:16px;border:1px solid hsl(var(--border)/.75);border-radius:12px;background:hsl(var(--card));box-shadow:0 3px 10px hsl(30 72% 17%/.045)}
        .dt-revenue-card-head{display:flex;flex-direction:column;gap:11px;padding-bottom:13px;border-bottom:1px solid hsl(var(--border)/.22)}
        .dt-period-caption{display:block;margin-bottom:4px;color:hsl(var(--muted-foreground));font-size:9px;font-weight:800;letter-spacing:.1em}
        .dt-total{font-family:var(--app-font-display);font-size:26px;letter-spacing:-.06em;line-height:1.15;font-variant-numeric:tabular-nums}
        .dt-total small{font-size:15px;letter-spacing:0}
        .dt-period-controls{display:flex;align-items:center;justify-content:space-between;gap:6px;color:hsl(var(--muted-foreground));font-size:11px;font-weight:700}
        .dt-period-controls button{width:25px;height:25px;display:grid;place-items:center;padding:0;border:1px solid hsl(var(--border)/.5);border-radius:7px;background:transparent;color:hsl(var(--foreground))}
        .dt-period-controls button:hover{background:hsl(var(--primary)/.09)}
        .dt-revenue-rows{padding:4px 0 6px}
        .dt-money-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:8px 0;color:hsl(var(--muted-foreground));font-size:10px;line-height:1.4}
        .dt-money-row span{max-width:64%}
        .dt-money-row b{color:hsl(var(--foreground));font-size:10px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
        .dt-money-row.is-strong span{color:hsl(var(--foreground))}
        .dt-money-row.is-strong b{font-weight:800;color:hsl(var(--primary))}
        .dt-service-breakdown{display:grid;gap:7px;padding:11px 0;border-top:1px solid hsl(var(--border)/.22)}
        .dt-service-breakdown>span{margin-bottom:1px;color:hsl(var(--muted-foreground));font-size:10px;font-weight:700}
        .dt-service-breakdown>div{display:flex;justify-content:space-between;gap:10px;font-size:10px}
        .dt-service-breakdown>div b{font-weight:700}
        .dt-service-breakdown>div span{color:hsl(var(--muted-foreground));text-align:right}
        .dt-detail-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;padding:10px 0 0;border:0;border-top:1px solid hsl(var(--border)/.22);background:transparent;color:hsl(var(--primary));font-size:10px;font-weight:800;text-align:left}
        .dt-detail-toggle svg{transition:transform .18s}
        .dt-detail-toggle svg.rotated{transform:rotate(180deg)}
        .dt-extra-details{padding-top:5px}
        .dt-extra-details .dt-money-row{padding:6px 0}
        .dt-day-card .dt-total{font-size:24px}
        .dt-revenue-footnote{padding:4px 2px 2px;color:hsl(var(--muted-foreground));font-size:9px;text-align:center}
        .dt-right-pane{min-width:0;min-height:0;display:flex;flex-direction:column;background:hsl(42 40% 97%)}
        .dt-function-bar{flex:0 0 auto;padding:17px 26px 0;border-bottom:1px solid hsl(var(--border)/.55);background:hsl(42 40% 97%)}
        .dt-function-label{margin:0 0 9px;color:hsl(var(--muted-foreground));font-size:9px;font-weight:800;letter-spacing:.12em}
        .dt-function-nav{display:flex;align-items:stretch;gap:5px;overflow-x:auto}
        .dt-function-link{position:relative;flex:0 0 auto;display:flex;align-items:center;gap:7px;min-height:44px;padding:0 12px;border:0;border-radius:8px 8px 0 0;background:transparent;color:hsl(var(--muted-foreground));font-size:11px;font-weight:700;white-space:nowrap}
        .dt-function-link:hover{background:hsl(var(--primary)/.06);color:hsl(var(--foreground))}
        .dt-function-link.active{color:hsl(var(--primary));background:hsl(var(--primary)/.075)}
        .dt-function-link.active:after{position:absolute;content:"";height:3px;left:10px;right:10px;bottom:-1px;border-radius:3px 3px 0 0;background:hsl(var(--primary))}
        .dt-page-scroll{min-height:0;flex:1;overflow-y:auto;overscroll-behavior:contain}
        .dt-page-content{width:min(100%,1050px);margin:0 auto;padding:30px 30px 36px}
        .dt-page-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:23px}
        .dt-page-heading h2{margin:0;font-family:var(--app-font-display);font-size:28px;line-height:1.15;letter-spacing:-.055em}
        .dt-page-subtitle{margin:7px 0 0;color:hsl(var(--muted-foreground));font-size:12px;font-weight:500}
        .dt-page-count{display:flex;align-items:baseline;gap:7px;padding:8px 11px;border:1px solid hsl(var(--border)/.55);border-radius:9px;background:hsl(var(--card)/.75);white-space:nowrap}
        .dt-page-count b{font-family:var(--app-font-display);font-size:18px;letter-spacing:-.04em}
        .dt-page-count span{color:hsl(var(--muted-foreground));font-size:10px}
        .dt-overview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}
        .dt-overview-tile{position:relative;min-width:0;min-height:138px;display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:20px;border:1px solid hsl(var(--tile-border));border-radius:14px;background:hsl(var(--tile-background));color:hsl(var(--tile-foreground));text-align:left}
        .dt-overview-tile>svg:first-child{color:hsl(var(--primary))}
        .dt-overview-tile strong{margin-top:auto;font:800 16px var(--app-font-display)}
        .dt-overview-tile span{color:hsl(var(--muted-foreground));font-size:10px}
        .dt-overview-tile .dt-overview-arrow{position:absolute;right:16px;top:18px;color:hsl(var(--muted-foreground))}
        .dt-overview-tile:hover{border-color:hsl(var(--primary));background:hsl(var(--card))}
        .dt-list-toolbar{display:flex;gap:9px;margin-bottom:13px}
        .dt-list-search{height:39px;flex:1;min-width:0;display:flex;align-items:center;gap:9px;padding:0 11px;border:1px solid hsl(var(--border)/.65);border-radius:9px;background:hsl(var(--card));color:hsl(var(--muted-foreground))}
        .dt-list-search input{width:100%;border:0;outline:0;background:transparent;color:hsl(var(--foreground));font-size:11px}
        .dt-list-search input::placeholder{color:hsl(var(--muted-foreground)/.82)}
        .dt-filter-button{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:0 11px;border:1px solid hsl(var(--border)/.65);border-radius:9px;background:hsl(var(--card));color:hsl(var(--foreground));font-size:10px;font-weight:700}
        .dt-card-list{overflow:hidden;border:1px solid hsl(var(--border)/.65);border-radius:11px;background:hsl(var(--card))}
        .dt-list-header,.dt-client-row{display:grid;grid-template-columns:minmax(190px,1.5fr) minmax(150px,1.3fr) minmax(75px,.6fr) minmax(75px,.65fr) 24px;align-items:center;gap:12px}
        .dt-list-header{min-height:36px;padding:0 15px;border-bottom:1px solid hsl(var(--border)/.45);background:hsl(var(--muted)/.42);color:hsl(var(--muted-foreground));font-size:8px;font-weight:800;letter-spacing:.08em}
        .dt-client-row{width:100%;min-height:70px;padding:8px 15px;border:0;border-bottom:1px solid hsl(var(--border)/.25);background:transparent;color:hsl(var(--foreground));text-align:left;cursor:pointer}
        .dt-client-row:last-of-type{border-bottom:0}
        .dt-client-row:hover{background:hsl(var(--primary)/.045)}
        .dt-client-row.selected{background:hsl(var(--primary)/.065);box-shadow:inset 3px 0 hsl(var(--primary))}
        .dt-client-name{display:flex;align-items:center;gap:10px;min-width:0}
        .dt-avatar{width:33px;height:33px;flex:0 0 33px;display:grid;place-items:center;border-radius:11px 11px 11px 4px;font-size:10px;font-style:normal;font-weight:800}
        .dt-avatar.rose{color:hsl(348 41% 36%);background:hsl(350 50% 90%)}
        .dt-avatar.green{color:hsl(150 43% 29%);background:hsl(147 35% 86%)}
        .dt-avatar.blue{color:hsl(202 42% 34%);background:hsl(201 45% 88%)}
        .dt-avatar.gold{color:hsl(32 61% 32%);background:hsl(40 66% 86%)}
        .dt-client-name>span,.dt-package-cell,.dt-person-copy{display:grid;min-width:0;gap:3px}
        .dt-client-name b,.dt-package-cell b,.dt-person-copy b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}
        .dt-client-name small,.dt-package-cell small,.dt-person-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:hsl(var(--muted-foreground));font-size:9px;font-weight:500}
        .dt-balance{display:grid;gap:3px}
        .dt-balance b{color:hsl(var(--primary));font-size:10px}
        .dt-balance small{color:hsl(var(--muted-foreground));font-size:9px}
        .dt-date{color:hsl(var(--muted-foreground));font-size:9px;white-space:nowrap}
        .dt-row-chevron{display:grid;place-items:center;color:hsl(var(--muted-foreground)/.7)}
        .dt-no-results{padding:28px 16px;color:hsl(var(--muted-foreground));font-size:12px;text-align:center}
        .dt-list-footer{display:flex;justify-content:space-between;align-items:center;padding:12px 2px;color:hsl(var(--muted-foreground));font-size:10px}
        .dt-list-footer>div{display:flex;align-items:center;gap:6px}
        .dt-list-footer button,.dt-list-footer b{width:27px;height:27px;display:grid;place-items:center;border:1px solid hsl(var(--border)/.65);border-radius:7px;background:hsl(var(--card));color:hsl(var(--foreground));font-size:10px}
        .dt-list-footer button:disabled{opacity:.4}
        .dt-list-footer b{border-color:hsl(var(--primary));background:hsl(var(--primary));color:white}
        .dt-selected-note{display:flex;align-items:center;gap:11px;margin-top:19px;padding:13px;border:1px solid hsl(var(--border)/.45);border-radius:10px;background:hsl(var(--card)/.65)}
        .dt-note-mark{width:32px;height:32px;display:grid;place-items:center;border-radius:9px;background:hsl(var(--primary)/.1);color:hsl(var(--primary))}
        .dt-selected-note>span:last-child{display:grid;gap:3px}
        .dt-selected-note b{font-size:10px}
        .dt-selected-note small{color:hsl(var(--muted-foreground));font-size:9px}
        .dt-simple-list,.dt-appointment-list,.dt-service-list{overflow:hidden;border:1px solid hsl(var(--border)/.65);border-radius:11px;background:hsl(var(--card))}
        .dt-simple-row,.dt-service-row{min-height:68px;display:flex;align-items:center;gap:13px;padding:10px 16px;border-bottom:1px solid hsl(var(--border)/.3);color:hsl(var(--muted-foreground))}
        .dt-simple-row:last-child,.dt-service-row:last-child{border-bottom:0}
        .dt-person-copy{flex:1}
        .dt-status,.dt-appt-status{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border-radius:99px;background:hsl(150 50% 88%);color:hsl(150 47% 27%);font-size:9px;font-weight:700;white-space:nowrap}
        .dt-status i{width:6px;height:6px;border-radius:50%;background:hsl(150 58% 30%)}
        .dt-status.off{background:hsl(40 70% 89%);color:hsl(32 74% 32%)}
        .dt-status.off i{background:hsl(32 74% 40%)}
        .dt-appointment-list{padding:4px 17px}
        .dt-appointment-row{min-height:78px;display:flex;align-items:center;gap:16px;border-bottom:1px solid hsl(var(--border)/.3);color:hsl(var(--muted-foreground))}
        .dt-appointment-row:last-child{border-bottom:0}
        .dt-appt-time{width:42px;color:hsl(var(--primary));font-family:var(--app-font-display);font-size:14px;font-variant-numeric:tabular-nums}
        .dt-appt-rule{height:32px;width:2px;border-radius:3px;background:hsl(var(--primary)/.45)}
        .dt-appt-copy{flex:1;display:grid;gap:4px}
        .dt-appt-copy b{color:hsl(var(--foreground));font-size:11px}
        .dt-appt-copy small{font-size:10px}
        .dt-appt-status{background:hsl(150 50% 88%);color:hsl(150 47% 27%)}
        .dt-appt-status.wait{background:hsl(40 70% 89%);color:hsl(32 74% 32%)}
        .dt-service-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:hsl(var(--primary)/.1);color:hsl(var(--primary))}
        .dt-service-price{color:hsl(var(--foreground));font-family:var(--app-font-display);font-size:12px;font-variant-numeric:tabular-nums}
        @media(max-width:850px){.dt-shell{height:auto;min-height:100vh;overflow:visible}.dt-workspace{grid-template-columns:1fr}.dt-left-pane,.dt-page-scroll{overflow:visible}.dt-left-pane{border-right:0;border-bottom:1px solid hsl(var(--border))}.dt-revenue-scroll{width:100%;max-width:600px}.dt-right-pane{min-height:700px}.dt-topbar{padding:0 16px}.dt-topbar-context{display:none}.dt-page-content{padding:24px 16px}.dt-function-bar{padding-left:14px;padding-right:14px}}
        @media(max-width:560px){.dt-topbar{height:58px;flex-basis:58px}.dt-page-heading{align-items:flex-start}.dt-page-heading h2{font-size:23px}.dt-page-count{display:none}.dt-function-link{padding:0 10px;font-size:10px}.dt-list-header{display:none}.dt-client-row{grid-template-columns:minmax(150px,1fr) minmax(80px,.7fr) 22px;gap:8px}.dt-package-cell{display:none}.dt-date{display:none}.dt-client-name b{font-size:9px}.dt-client-name small{font-size:8px}.dt-list-toolbar{flex-wrap:wrap}.dt-list-search{flex-basis:100%}.dt-filter-button{height:34px}.dt-appointment-row{gap:9px}.dt-appt-status{font-size:8px}.dt-appt-copy small{font-size:9px}}
      `}</style>
    </div>
  );
}
