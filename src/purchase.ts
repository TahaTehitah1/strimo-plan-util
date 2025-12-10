import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

/**
 * Generates a unique username from an email address
 * Uses email prefix + timestamp to ensure uniqueness
 */
const generateUsernameFromEmail = (email: string): string => {
  console.log("Generating username for email: " + email);

  if (!email || !email.includes("@")) {
    throw new Error("Invalid email address");
  }

  // Extract username part before @
  const emailPrefix = email.split("@")[0];

  // Clean the prefix: remove special characters, keep only alphanumeric
  const cleanedPrefix = emailPrefix.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

  if (!cleanedPrefix) {
    throw new Error("Email prefix is invalid after cleaning");
  }

  // Take first 6 characters of cleaned prefix (or less if shorter)
  const prefixPart = cleanedPrefix.substring(0, 6).toUpperCase();

  // Generate timestamp: YYMMDDHHMM for better uniqueness
  const now = new Date();
  const timestamp =
    `${now.getFullYear().toString().slice(-2)}` +
    `${(now.getMonth() + 1).toString().padStart(2, "0")}` +
    `${now.getDate().toString().padStart(2, "0")}` +
    `${now.getHours().toString().padStart(2, "0")}` +
    `${now.getMinutes().toString().padStart(2, "0")}`;

  return `${prefixPart}${timestamp}`;
};

/**
 * Generates a random password
 */
const generatePassword = (length: number = 8): string => {
  const charset = "abcdefghijklmnopqrstuvwxyz";
  let password = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    password += charset[randomIndex];
  }
  return password;
};

interface PurchaseResult {
  username: string;
  password: string;
  success: boolean;
  error?: string;
  macAddress?: string;
  serverUrl?: string;
  portalURL?: string;
  m3uUrl?: string;
  epgUrl?: string;
  backupServers?: string;
}

/**
 * Purchases a plan from the external IPTV provider
 * @param planId - The plan ID to purchase
 * @param email - The buyer's email address
 * @param orderType - The type of order (STANDARD or MAG_DEVICE)
 * @param macAddress - MAC address for MAG_DEVICE orders (required if orderType is MAG_DEVICE)
 * @param isFreeTrial - Whether this is a free trial purchase
 * @returns Object containing username, password, and success status
 */
export const purchasePlan = async (
  planId: string,
  email: string,
  orderType: "STANDARD" | "MAG_DEVICE" = "STANDARD",
  macAddress?: string,
  isFreeTrial: boolean = false
): Promise<PurchaseResult> => {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--disable-web-security",
        "--allow-running-insecure-content",
        "--ignore-certificate-errors",
      ],
    });

    const page = await browser.newPage();
    const timeout = 60000;
    page.setDefaultTimeout(timeout);

    // Handle dialogs automatically
    page.on("dialog", async (dialog) => {
      console.log(dialog.message());
      await dialog.accept();
    });

    // Navigate to the IPTV provider
    const baseUrl = process.env.IPTV_PROVIDER_URL;

    if (!baseUrl) {
      throw new Error("IPTV_PROVIDER_URL not set in environment variables");
    }

    const endpoint = orderType === "MAG_DEVICE" ? "/mag" : "/line";
    let providerUrl = baseUrl + endpoint;

    await page.goto(providerUrl, {
      waitUntil: "networkidle2",
    });

    // Check if login is required
    if (page.url().includes("login")) {
      const providerUsername = process.env.IPTV_PROVIDER_USERNAME;
      const providerPassword = process.env.IPTV_PROVIDER_PASSWORD;

      if (!providerUsername || !providerPassword) {
        throw new Error(
          "IPTV provider credentials not set in environment variables"
        );
      }

      await page.type("#username", providerUsername);
      await page.type("#password", providerPassword);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2" }),
        page.click("#login_button"),
      ]);
    }

    // Select the package/plan
    await page.select("#package", planId);

    let username = "";
    let password = "";

    if (orderType === "STANDARD") {
      // Generate credentials for standard orders
      username = generateUsernameFromEmail(email);
      password = generatePassword();

      console.log(`Generated Username: ${username}`);
      console.log(`Generated Password: ${password}`);

      // Fill in the form
      await page.type("#username", username);
      await page.type("#password", password);
    } else {
      // Handle MAG_DEVICE orders
      if (!macAddress) {
        throw new Error("macAddress is required for MAG_DEVICE orders");
      }

      console.log(`Using MAC address: ${macAddress}`);

      // Fill in the MAC address
      await page.type("#mac", macAddress);

      // For MAG devices, use MAC as username and empty password
      username = macAddress;
      password = "";
    }

    // Click submit button
    await page.click("#user-details > ul > li > a");

    await page.waitForSelector("#submit_button", { visible: true });

    await page.click("#submit_button");

    // Wait for navigation/confirmation
    await page.waitForNavigation({ waitUntil: "networkidle2" });

    console.log(
      `Successfully purchased ${orderType} planId: ${planId} for email: ${email}`
    );

    if (browser) {
      await browser.close();
    }

    // Build complete credentials with server info
    const serverUrl = process.env.IPTV_SERVER_URL || "http://ky-tv.cc:8080";
    const backupServers = process.env.IPTV_BACKUP_SERVERS || "";
    const portalURL = process.env.MAG_PORTAL_URL || "";

    const result: PurchaseResult = {
      username,
      password,
      success: true,
    };

    if (orderType === "STANDARD") {
      result.serverUrl = serverUrl;
      result.backupServers = backupServers;
      result.m3uUrl = `${serverUrl}/get.php?username=${username}&password=${password}&type=m3u_plus&output=ts`;
      result.epgUrl = `${serverUrl}/xmltv.php?username=${username}&password=${password}`;
    } else {
      result.macAddress = macAddress;
      result.portalURL = portalURL;
    }

    return result;
  } catch (error) {
    console.error("Error during purchase:", error);

    if (browser) {
      await browser.close();
    }

    return {
      username: "",
      password: "",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
};

/**
 * Validates email format
 */
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};
