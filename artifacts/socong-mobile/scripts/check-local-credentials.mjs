import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const credentialsPath = path.join(appRoot, "credentials.json");

function safeCredentialFile(relativePath, label) {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    return { label, error: "chưa khai báo đường dẫn" };
  }
  if (path.isAbsolute(relativePath)) {
    return { label, error: "đường dẫn phải nằm trong thư mục dự án" };
  }
  const resolved = path.resolve(appRoot, relativePath);
  if (!resolved.startsWith(`${appRoot}${path.sep}`)) {
    return { label, error: "đường dẫn phải nằm trong thư mục dự án" };
  }
  return { label, path: resolved };
}

const missing = [];
let credentials;

try {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
} catch (error) {
  if (error?.code === "ENOENT") {
    console.error("Chưa có credentials.json. Tạo tệp cục bộ trước.");
    process.exit(1);
  }
  if (error instanceof SyntaxError) {
    console.error("credentials.json không phải JSON hợp lệ.");
    process.exit(1);
  }
  throw error;
}

const android = credentials?.android?.keystore;
const ios = credentials?.ios;
const certificate = ios?.distributionCertificate;

for (const [label, value] of [
  ["Android keystore password", android?.keystorePassword],
  ["Android key alias", android?.keyAlias],
  ["Android key password", android?.keyPassword],
  ["iOS certificate password", certificate?.password],
]) {
  if (typeof value !== "string" || !value.trim()) missing.push(label);
}

const files = [
  safeCredentialFile(android?.keystorePath, "Android keystore"),
  safeCredentialFile(ios?.provisioningProfilePath, "iOS provisioning profile"),
  safeCredentialFile(certificate?.path, "iOS distribution certificate"),
];

for (const item of files) {
  if (item.error) {
    missing.push(`${item.label}: ${item.error}`);
    continue;
  }
  try {
    await access(item.path);
  } catch {
    missing.push(`${item.label}: tệp chưa được đặt ở vị trí đã khai báo`);
  }
}

if (missing.length) {
  console.error("Thiết lập credentials cục bộ chưa hoàn tất:");
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log("Cấu hình credentials cục bộ hợp lệ; không in giá trị bí mật.");
