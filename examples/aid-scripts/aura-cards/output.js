// This is just the Auto Cards original script pasted here. Modify this file instead of the raw Auto Cards file in BetterRepository.

// Your "Output" tab should look like this
const modifier = (text) => {
  // Your other output modifier scripts go here (preferred)
  text = AutoCards("output", text);
  // Your other output modifier scripts go here (alternative)
  return {text};
};
modifier(text);