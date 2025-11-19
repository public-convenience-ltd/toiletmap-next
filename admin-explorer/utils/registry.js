export const componentRegistry = new Map();
let componentIdCounter = 0;

export const getNextComponentId = (prefix) => {
  return `${prefix}-${componentIdCounter++}`;
};
