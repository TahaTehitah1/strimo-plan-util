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
  console.log(`PurchasePlan started: planId=${planId}, email=${email}, orderType=${orderType}, isFreeTrial=${isFreeTrial}`);
  let browser;

  try {
    console.log('Launching Puppeteer browser (headless: true)');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-web-security",
        "--allow-running-insecure-content",
        "--ignore-certificate-errors",
      ],
    });

    console.log('Creating new browser page');
    const page = await browser.newPage();
    const timeout = 30000; // Reduced from 120000ms to 30000ms for better performance
    page.setDefaultTimeout(timeout);
    console.log(`Page timeout set to ${timeout}ms`);

    // Handle dialogs automatically
    page.on("dialog", async (dialog) => {
      console.log(`Dialog detected: ${dialog.message()}`);
      await dialog.accept();
    });

    // Navigate to the IPTV provider
    console.log('Checking IPTV provider URL configuration');
    const baseUrl = process.env.IPTV_PROVIDER_URL;

    if (!baseUrl) {
      throw new Error("IPTV_PROVIDER_URL not set in environment variables");
    }

    const endpoint = orderType === "MAG_DEVICE" ? "/mag" : "/line";
    let providerUrl = baseUrl + endpoint;
    console.log(`Navigating to provider URL: ${providerUrl}`);

    await page.goto(providerUrl, {
      waitUntil: "networkidle0", // Changed from domcontentloaded to networkidle0 for better performance
    });

    console.log(`Navigation complete. Current URL: ${page.url()}`);

    // Check if login is required
    console.log('Checking if login is required');
    if (page.url().includes("login")) {
      console.log('Login required, entering credentials');
      const providerUsername = process.env.IPTV_PROVIDER_USERNAME;
      const providerPassword = process.env.IPTV_PROVIDER_PASSWORD;

      if (!providerUsername || !providerPassword) {
        throw new Error(
          "IPTV provider credentials not set in environment variables"
        );
      }

      console.log('Filling login form');
      await page.type("#username", providerUsername);
      await page.type("#password", providerPassword);
      console.log('Submitting login form');
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle0" }), // Changed from domcontentloaded to networkidle0 for better performance
        page.click("#login_button"),
      ]);
      console.log('Login navigation complete');
    } else {
      console.log('Login not required');
    }

    // Select the package/plan
    console.log(`Selecting plan: ${planId}`);
    await page.select("#package", planId);

    let username = "";
    let password = "";

    if (orderType === "STANDARD") {
      // Generate credentials for standard orders
      console.log('Generating credentials for standard order');
      username = generateUsernameFromEmail(email);
      password = generatePassword();

      console.log(`Generated Username: ${username}`);
      console.log(`Generated Password: ${password}`);

      // Fill in the form
      console.log('Filling standard order form');
      await page.type("#username", username);
      await page.type("#password", password);
    } else {
      // Handle MAG_DEVICE orders
      console.log('Processing MAG_DEVICE order');
      if (!macAddress) {
        throw new Error("macAddress is required for MAG_DEVICE orders");
      }

      console.log(`Using MAC address: ${macAddress}`);

      // Fill in the MAC address
      console.log('Filling MAG device form with MAC address');
      await page.type("#mac", macAddress);

      // For MAG devices, use MAC as username and empty password
      username = macAddress;
      password = "";
    }

    // Click submit button
    console.log('Clicking submit button for user details');
    await page.click("#user-details > ul > li > a");

    console.log('Waiting for final submit button');
    await page.waitForSelector("#submit_button", { visible: true });

    console.log('Clicking final submit button');
    await page.click("#submit_button");

    // Wait for navigation/confirmation
    console.log('Waiting for navigation after submission');
    await page.waitForNavigation({ waitUntil: "networkidle0" }); // Changed from domcontentloaded to networkidle0 for better performance
    // Add a small delay to ensure the page is fully processed
    await page.waitForTimeout(2000);

    console.log(
      `Successfully purchased ${orderType} planId: ${planId} for email: ${email}`
    );

    console.log('Closing browser');
    if (browser) {
      await browser.close();
    }

    // Build complete credentials with server info
    console.log('Building purchase result with server information');
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
      console.log(`Generated M3U URL: ${result.m3uUrl}`);
      console.log(`Generated EPG URL: ${result.epgUrl}`);
    } else {
      result.macAddress = macAddress;
      result.portalURL = portalURL;
      console.log(`MAG device portal URL: ${result.portalURL}`);
    }

    console.log(`PurchasePlan completed successfully for ${email}`);
    return result;
  } catch (error) {
    console.error("Error during purchase:", error);

    console.log('Attempting to close browser after error');
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
