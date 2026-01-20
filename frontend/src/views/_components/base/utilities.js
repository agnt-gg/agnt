export function generateRandomId() {
  return Math.random().toString(36).substr(2, 9);
}

export function formatTextToDivId(text) {
  return text
    .trim() // remove whitespace from both ends
    .replace(/\s+/g, "-") // replace spaces with hyphens
    .replace(/[^a-zA-Z0-9-]/g, "") // remove non-alphanumeric characters except hyphens
    .replace(/^-+|-+$/g, "") // remove leading and trailing hyphens
    .toLowerCase(); // convert to lowercase
}

export function unformatDivIdToText(formattedText) {
  return formattedText
    .replace(/-/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function capitalizeFirstLetter(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
