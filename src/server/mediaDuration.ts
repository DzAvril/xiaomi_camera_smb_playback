import fs from "node:fs";

type MediaFileSystem = Pick<typeof fs, "closeSync" | "openSync" | "readSync" | "statSync">;

type BoxHeader = {
  contentOffset: number;
  endOffset: number;
  type: string;
};

function readBytes(fileSystem: MediaFileSystem, fd: number, offset: number, length: number): Buffer | null {
  const buffer = Buffer.alloc(length);
  const bytesRead = fileSystem.readSync(fd, buffer, 0, length, offset);
  if (bytesRead !== length) {
    return null;
  }
  return buffer;
}

function readBoxHeader(fileSystem: MediaFileSystem, fd: number, offset: number, limit: number): BoxHeader | null {
  if (offset + 8 > limit) {
    return null;
  }

  const header = readBytes(fileSystem, fd, offset, 8);
  if (!header) {
    return null;
  }

  const size32 = header.readUInt32BE(0);
  const type = header.toString("ascii", 4, 8);
  let size = size32;
  let headerSize = 8;

  if (size32 === 1) {
    const extendedSize = readBytes(fileSystem, fd, offset + 8, 8);
    if (!extendedSize) {
      return null;
    }
    const size64 = extendedSize.readBigUInt64BE(0);
    if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    size = Number(size64);
    headerSize = 16;
  } else if (size32 === 0) {
    size = limit - offset;
  }

  if (size < headerSize || offset + size > limit) {
    return null;
  }

  return {
    contentOffset: offset + headerSize,
    endOffset: offset + size,
    type,
  };
}

function readMvhdDurationSeconds(fileSystem: MediaFileSystem, fd: number, contentOffset: number, contentSize: number) {
  const fullBoxHeader = readBytes(fileSystem, fd, contentOffset, 4);
  if (!fullBoxHeader) {
    return null;
  }

  const version = fullBoxHeader.readUInt8(0);
  if (version === 0) {
    if (contentSize < 20) {
      return null;
    }
    const timing = readBytes(fileSystem, fd, contentOffset + 12, 8);
    if (!timing) {
      return null;
    }
    const timescale = timing.readUInt32BE(0);
    const duration = timing.readUInt32BE(4);
    return timescale > 0 ? duration / timescale : null;
  }

  if (version === 1) {
    if (contentSize < 32) {
      return null;
    }
    const timescaleBuffer = readBytes(fileSystem, fd, contentOffset + 20, 4);
    const durationBuffer = readBytes(fileSystem, fd, contentOffset + 24, 8);
    if (!timescaleBuffer || !durationBuffer) {
      return null;
    }
    const timescale = timescaleBuffer.readUInt32BE(0);
    const duration = durationBuffer.readBigUInt64BE(0);
    if (timescale <= 0 || duration > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    return Number(duration) / timescale;
  }

  return null;
}

function readSidxDurationSeconds(fileSystem: MediaFileSystem, fd: number, contentOffset: number, contentSize: number) {
  const payload = readBytes(fileSystem, fd, contentOffset, contentSize);
  if (!payload || payload.length < 24) {
    return null;
  }

  const version = payload.readUInt8(0);
  const timescale = payload.readUInt32BE(8);
  if (timescale <= 0) {
    return null;
  }

  let referenceCountOffset: number;
  if (version === 0) {
    referenceCountOffset = 22;
  } else if (version === 1) {
    referenceCountOffset = 30;
  } else {
    return null;
  }

  if (payload.length < referenceCountOffset + 2) {
    return null;
  }

  const referenceCount = payload.readUInt16BE(referenceCountOffset);
  let entryOffset = referenceCountOffset + 2;
  let duration = 0n;

  for (let index = 0; index < referenceCount; index += 1) {
    if (entryOffset + 12 > payload.length) {
      return null;
    }
    duration += BigInt(payload.readUInt32BE(entryOffset + 4));
    entryOffset += 12;
  }

  if (duration <= 0n || duration > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }

  return Number(duration) / timescale;
}

function findMovieDurationSeconds(fileSystem: MediaFileSystem, fd: number, moovStart: number, moovEnd: number): number | null {
  let offset = moovStart;

  while (offset + 8 <= moovEnd) {
    const child = readBoxHeader(fileSystem, fd, offset, moovEnd);
    if (!child) {
      return null;
    }

    if (child.type === "mvhd") {
      const durationSeconds = readMvhdDurationSeconds(
        fileSystem,
        fd,
        child.contentOffset,
        child.endOffset - child.contentOffset,
      );
      return Number.isFinite(durationSeconds) && durationSeconds !== null && durationSeconds > 0 ? durationSeconds : null;
    }

    offset = child.endOffset;
  }

  return null;
}

export function readMp4DurationSeconds(filePath: string, fileSystem: MediaFileSystem = fs): number | null {
  let fd: number | null = null;

  try {
    const fileSize = fileSystem.statSync(filePath).size;
    fd = fileSystem.openSync(filePath, "r");
    let offset = 0;

    while (offset + 8 <= fileSize) {
      const box = readBoxHeader(fileSystem, fd, offset, fileSize);
      if (!box) {
        return null;
      }

      if (box.type === "moov") {
        const durationSeconds = findMovieDurationSeconds(fileSystem, fd, box.contentOffset, box.endOffset);
        if (durationSeconds !== null) {
          return durationSeconds;
        }
      }

      if (box.type === "sidx") {
        const durationSeconds = readSidxDurationSeconds(fileSystem, fd, box.contentOffset, box.endOffset - box.contentOffset);
        if (durationSeconds !== null) {
          return durationSeconds;
        }
      }

      offset = box.endOffset;
    }
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      fileSystem.closeSync(fd);
    }
  }

  return null;
}
