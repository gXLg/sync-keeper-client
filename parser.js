function parseCustomJson(input) {
  let i = 0;
  let output = "";

  while (i < input.length) {
    const char = input[i];

    if (char === "\"") {
      // Skip JSON strings, respecting escape sequences.
      output += char;
      i++;

      while (i < input.length) {
        const c = input[i++];
        output += c;

        if (c === "\\") {
          output += input[i++];
        } else if (c === "\"") {
          break;
        }
      }
      continue;
    }
    if (input.startsWith('Infinity', i)) {
      const next = input[i + 8];
      if ((i === 0 || /[\s:[,\-]/.test(input[i - 1])) && (next === undefined || /[\s,}\]]/.test(next))) {
        output += "1e9999";
        i += 8;
        continue;
      }
    }

    output += char;
    i++;
  }

  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

module.exports = { parseCustomJson };
