// Base entity ID interfaces
export interface EntityKindId<TKind> {
  kind: TKind;
}

export interface EntityTypeId<TKind> extends EntityKindId<TKind> {
  type: string;
}

// Version can exist without a number
export interface EntityVersionId<TKind> extends EntityTypeId<TKind> {
  version: number;
}

// Number is optional and can be combined with version
export interface EntityNumId<TKind> extends EntityTypeId<TKind> {
  num: number;
}

export interface EntityVersionNumId<TKind> extends EntityVersionId<TKind> {
  num: number;
}

// Type guards
export function hasType<TKind>(entity: EntityKindId<TKind>): entity is EntityTypeId<TKind> {
  return "type" in entity;
}

export function hasNum<TKind>(
  entity: EntityKindId<TKind>,
): entity is EntityNumId<TKind> | EntityVersionNumId<TKind> {
  return "num" in entity;
}

export function hasVersion<TKind>(
  entity: EntityKindId<TKind>,
): entity is EntityVersionId<TKind> | EntityVersionNumId<TKind> {
  return "version" in entity;
}

// Base string conversion functions
function kindString<TKind>(entity: EntityKindId<TKind>): string {
  return `${entity.kind}`;
}

function typeString<TKind>(entity: EntityTypeId<TKind>): string {
  return `${entity.type}`;
}

function versionString(version: number): string {
  return `${version}`;
}

function numString(num: number): string {
  return `[${num}]`;
}

// Specific entity to string conversions
export function entityToKindString<TKind>(entity: EntityKindId<TKind>): string {
  return kindString(entity);
}

export function entityToTypeIdString<TKind>(entity: EntityTypeId<TKind>): string {
  return `${kindString(entity)}:${typeString(entity)}`;
}

export function entityToVersionIdString<TKind>(entity: EntityVersionId<TKind>): string {
  return `${entityToTypeIdString(entity)}:${versionString(entity.version)}`;
}

export function entityToNumIdString<TKind>(entity: EntityNumId<TKind>): string {
  return `${entityToTypeIdString(entity)}${numString(entity.num)}`;
}

export function entityToVersionNumIdString<TKind>(entity: EntityVersionNumId<TKind>): string {
  return `${entityToTypeIdString(entity)}${numString(entity.num)}:${versionString(entity.version)}`;
}

// Generic toString that handles any entity type and outputs full string
export function entityToString<TKind>(
  entity:
    | EntityKindId<TKind>
    | EntityTypeId<TKind>
    | EntityVersionId<TKind>
    | EntityNumId<TKind>
    | EntityVersionNumId<TKind>,
): string {
  if (hasVersion(entity) && hasNum(entity)) {
    return entityToVersionNumIdString(entity as EntityVersionNumId<TKind>);
  }
  if (hasVersion(entity)) {
    return entityToVersionIdString(entity as EntityVersionId<TKind>);
  }
  if (hasNum(entity)) {
    return entityToNumIdString(entity as EntityNumId<TKind>);
  }
  if (hasType(entity)) {
    return entityToTypeIdString(entity);
  }
  return entityToKindString(entity);
}

// Generic parsing functions
export function stringToEntityKind<TKind>(
  str: string,
  kindValidator: (kind: string) => TKind,
): EntityKindId<TKind> {
  return {
    kind: kindValidator(str),
  };
}

export function stringToEntityType<TKind>(
  str: string,
  kindValidator: (kind: string) => TKind,
): EntityTypeId<TKind> {
  const [kind, type] = str.split(":");
  if (!type) {
    throw new Error(`Invalid entity type ID format: ${str}`);
  }

  return {
    kind: kindValidator(kind),
    type,
  };
}

export function stringToEntityVersion<TKind>(
  str: string,
  kindValidator: (kind: string) => TKind,
): EntityVersionId<TKind> {
  let kindPart: string;
  let typePart: string;
  let version: string;
  const kindTypeParts = [];
  const splitted = str.split(":");
  if (splitted.length > 2) {
    [kindPart, typePart, version] = splitted;
    kindTypeParts.push(kindPart, typePart);
  } else {
    [typePart, version] = splitted;
    kindTypeParts.push(typePart);
  }

  if (!version) {
    throw new Error(`Invalid entity version ID format: ${str}`);
  }

  const typeId = stringToEntityType(kindTypeParts.join(":"), kindValidator);
  return {
    ...typeId,
    version: parseInt(version, 10),
  };
}

export function stringToEntityNum<TKind>(
  str: string,
  kindValidator: (kind: string) => TKind,
): EntityNumId<TKind> {
  const match = str.match(/^(.*?)\[(\d+)\]$/);
  if (!match) {
    throw new Error(`Invalid entity num ID format: ${str}`);
  }

  const typeId = stringToEntityType(match[1], kindValidator);
  return {
    ...typeId,
    num: parseInt(match[2], 10),
  };
}

export function stringToEntityVersionNum<TKind>(
  str: string,
  kindValidator: (kind: string) => TKind,
): EntityVersionNumId<TKind> {
  let kindPart: string;
  let typePart: string;
  let version: string;
  const kindTypeParts = [];
  const splitted = str.split(":");
  if (splitted.length > 2) {
    [kindPart, typePart, version] = splitted;
    kindTypeParts.push(kindPart, typePart);
  } else {
    [typePart, version] = splitted;
    kindTypeParts.push(typePart);
  }

  if (!version) {
    throw new Error(`Invalid entity version num ID format: ${str}`);
  }

  const numId = stringToEntityNum(kindTypeParts.join(":"), kindValidator);
  return {
    ...numId,
    version: parseInt(version, 10),
  };
}
