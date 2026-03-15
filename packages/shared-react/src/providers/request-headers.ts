import type { HTTPHeaders } from "@trpc/client";

import { createClientLogger } from "@norish/shared/lib/logger";

import { OPERATION_ID_HEADER } from "./operation-id-link";

type OperationLike = {
  path?: string;
  type?: string;
  context?: Record<string, unknown>;
};

const log = createClientLogger("TrpcRequestHeaders");

function appendHeaders(target: Headers, source?: HTTPHeaders): void {
  if (!source) {
    return;
  }

  if (typeof (source as Headers)[Symbol.iterator] === "function") {
    for (const [key, value] of source as Iterable<[string, string]>) {
      target.set(key, value);
    }

    return;
  }

  for (const [key, value] of Object.entries(source as Record<string, string | string[] | undefined>)) {
    if (typeof value === "undefined") {
      continue;
    }

    target.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
}

function getOperationHeaders(op: OperationLike): HTTPHeaders | undefined {
  const headers = op.context?.headers;

  if (!headers || typeof headers !== "object") {
    return undefined;
  }

  return headers as HTTPHeaders;
}

export function mergeHttpHeaders(...sources: Array<HTTPHeaders | undefined>): Record<string, string> {
  const headers = new Headers();

  for (const source of sources) {
    appendHeaders(headers, source);
  }

  return Object.fromEntries(headers.entries());
}

export function createRequestHeadersResolver(getHeaders: () => HTTPHeaders) {
  return ({ op }: { op: OperationLike }) => {
    const headers = mergeHttpHeaders(getHeaders(), getOperationHeaders(op));
    const operationId = headers[OPERATION_ID_HEADER];

    if (operationId) {
      log.debug(
        { path: op.path, type: op.type, operationId },
        "Sending tRPC request with correlation ID"
      );
    }

    return headers;
  };
}

export function createBatchRequestHeadersResolver(getHeaders: () => HTTPHeaders) {
  return ({ opList }: { opList: OperationLike[] }) =>
    mergeHttpHeaders(getHeaders(), ...opList.map((op) => getOperationHeaders(op)));
}
