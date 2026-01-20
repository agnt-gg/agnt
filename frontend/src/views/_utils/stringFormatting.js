export function formatTextToDivId(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-") // Replace one or more spaces with a single hyphen
    .replace(/[^a-z0-9-]/g, "") // Remove all characters except lowercase letters, numbers, and hyphens
    .replace(/-+/g, "-") // Replace multiple consecutive hyphens with a single hyphen
    .replace(/(^-|-$)/g, ""); // Remove leading and trailing hyphens
}
export function unformatDivIdToText(divId) {
  return divId
    .split("-")
    .filter((word) => word.length > 0) // Filter out empty strings
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
export function capitalizeFirstLetter(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
export function camelCaseToTitleCase(camelCaseStr) {
  // List of common business and code acronyms
  const commonAcronyms = new Set([
    "API",
    "ASCII",
    "AWS",
    "CEO",
    "CIO",
    "CRUD",
    "CSS",
    "CSV",
    "CTO",
    "DB",
    "DNS",
    "DOM",
    "EDT",
    "EST",
    "FAQ",
    "FTP",
    "GMT",
    "HTML",
    "HTTP",
    "HTTPS",
    "ID",
    "IP",
    "JSON",
    "JWT",
    "LAN",
    "MIME",
    "NASA",
    "NATO",
    "OAuth",
    "PDF",
    "PHP",
    "PNG",
    "REST",
    "RSS",
    "SaaS",
    "SCSS",
    "SDK",
    "SEO",
    "SQL",
    "SSH",
    "SSL",
    "SVG",
    "TCP",
    "TLS",
    "UI",
    "URI",
    "URL",
    "USB",
    "UTC",
    "UUID",
    "VPN",
    "WAN",
    "XML",
    "YAML",
  ]);
  return camelCaseStr
    .replace(/([A-Z])([A-Z])(?=[a-z])/g, "$1 $2") // Split consecutive uppercase letters before a lowercase letter
    .replace(/([a-z])([A-Z])/g, "$1 $2") // Add space between lowercase and uppercase letters
    .replace(/^./, (str) => str.toUpperCase()) // Capitalize the first letter
    .replace(/\b(\w+)\b/g, (match) => {
      // Check if the word is a common acronym
      if (commonAcronyms.has(match.toUpperCase())) {
        return match.toUpperCase();
      }
      // Capitalize first letter of other words
      return match.charAt(0).toUpperCase() + match.slice(1).toLowerCase();
    });
}
export function toKebabCase(str) {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2") // Convert camelCase to kebab-case
    .replace(/[\s_]+/g, "-") // Replace spaces and underscores with hyphens
    .replace(/[^a-zA-Z0-9-]/g, "-") // Replace special characters with hyphens
    .replace(/-+/g, "-") // Replace multiple consecutive hyphens with a single hyphen
    .replace(/^-|-$/g, "") // Remove leading and trailing hyphens
    .toLowerCase(); // Convert to lowercase
}
