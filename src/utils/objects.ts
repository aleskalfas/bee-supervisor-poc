type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Recursively updates original object with values from update object
 * @param original The original object to update
 * @param update Partial object containing updates
 * @returns The updated original object
 */
export function updateDeepPartialObject<T extends object>(original: T, update: DeepPartial<T>): T {
  const keys = Object.keys(update) as (keyof T)[];

  for (const key of keys) {
    const updateValue = update[key];

    // Handle nested objects recursively
    if (
      updateValue !== null &&
      typeof updateValue === "object" &&
      !Array.isArray(updateValue) &&
      typeof original[key] === "object"
    ) {
      original[key] = {
        ...(original[key] as object),
        ...updateDeepPartialObject(original[key] as object, updateValue as DeepPartial<T[keyof T]>),
      } as T[keyof T];
    } else {
      original[key] = updateValue as T[keyof T];
    }
  }

  return original;
}
