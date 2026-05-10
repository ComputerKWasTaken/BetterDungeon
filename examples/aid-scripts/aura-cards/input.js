// This is just the Auto Cards original script pasted here. Modify this file instead of the raw Auto Cards file in BetterRepository.

// Your "Input" tab should look like this
const modifier = (text) => {
  // Your other input modifier scripts go here (preferred)
  text = AutoCards("input", text);
  // Your other input modifier scripts go here (alternative)
  return {text};
};
modifier(text);