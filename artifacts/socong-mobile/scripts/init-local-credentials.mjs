import { open, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const credentialsPath = path.join(appRoot, "credentials.json");
const credentialsDir = path.join(appRoot, "credentials");
const template = {
  android: {
    keystore: {
      keystorePath: "credentials/android/keystore.jks",
      keystorePassword: "",
      keyAlias: "",
      keyPassword: "",
    },
  },
  ios: {
    provisioningProfilePath: "credentials/ios/profile.mobileprovision",
    distributionCertificate: {
      path: "credentials/ios/distribution.p12",
      password: "",
    },
  },
};

await mkdir(credentialsDir, { recursive: true });

try {
  const file = await open(credentialsPath, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(template, null, 2)}\n`, "utf8");
    await file.chmod(0o600);
  } finally {
    await file.close();
  }
  console.log("Đã tạo credentials.json cục bộ với quyền truy cập riêng tư.");
  console.log("Điền thông tin ký của anh trực tiếp trong tệp này; không gửi qua chat.");
} catch (error) {
  if (error?.code === "EEXIST") {
    console.log("credentials.json đã tồn tại; giữ nguyên và không ghi đè.");
    process.exit(0);
  }
  throw error;
}
