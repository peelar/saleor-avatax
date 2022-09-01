/** @jest-environment setup-polly-jest/jest-environment-node */
import { PollyServer } from "@pollyjs/core";
import * as joseModule from "jose";
import { NextApiRequest, NextApiResponse } from "next";
import { ResponseTaxPayload } from "../../../backend/types";
import toNextHandler from "../../../pages/api/webhooks/order-calculate-taxes";
import { setupPollyMiddleware, setupRecording } from "../../pollySetup";
import {
  dummyCalculateTaxesPayloadForOrder,
  dummyFetchTaxesResponse,
  mockRequest,
} from "../../utils";
import Avatax from "ava-typescript";

jest.mock("next/dist/compiled/raw-body/index.js", () => ({
  __esModule: true,
  default: jest.fn((_) => ({
    toString: () => '{"dummy":12}',
  })),
}));

const testDomain = "localhost:8000";

describe("api/webhooks/order-calculate-taxes", () => {
  const context = setupRecording();
  beforeEach(() => {
    process.env.SALEOR_DOMAIN = testDomain;
    const server = context.polly.server;
    setupPollyMiddleware(server as unknown as PollyServer);
  });

  it("rejects when saleor domain is missing", async () => {
    const mockedCreateTransaction = jest
      .spyOn(Avatax.prototype, "createTransaction")
      .mockResolvedValue(dummyFetchTaxesResponse);

    const domain = undefined;
    const { req, res } = mockRequest({
      method: "POST",
      event: "order_calculate_taxes",
      domain,
    });

    const orderPayload = {
      taxBase: { ...dummyCalculateTaxesPayloadForOrder },
      __typename: "CalculateTaxes",
    };
    req.body = orderPayload;

    await toNextHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    );

    expect(res.statusCode).toBe(400);
    expect(mockedCreateTransaction).not.toHaveBeenCalled();

    mockedCreateTransaction.mockRestore();
  });

  it("rejects when saleor event is missing", async () => {
    const mockedCreateTransaction = jest
      .spyOn(Avatax.prototype, "createTransaction")
      .mockResolvedValue(dummyFetchTaxesResponse);

    const event = undefined;
    const { req, res } = mockRequest({
      method: "POST",
      event,
      domain: testDomain,
    });

    const orderPayload = {
      taxBase: { ...dummyCalculateTaxesPayloadForOrder },
      __typename: "CalculateTaxes",
    };
    req.body = orderPayload;

    await toNextHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    );

    expect(res.statusCode).toBe(400);
    expect(mockedCreateTransaction).not.toHaveBeenCalled();

    mockedCreateTransaction.mockRestore();
  });

  it.skip("rejects when saleor signature is empty", async () => {
    const mockedCreateTransaction = jest
      .spyOn(Avatax.prototype, "createTransaction")
      .mockResolvedValue(dummyFetchTaxesResponse);

    const signature = undefined;
    const { req, res } = mockRequest({
      method: "POST",
      event: "order_calculate_taxes",
      domain: testDomain,
      signature,
    });

    // set body to undefined as the webhook handler expects that
    // the processed body doesn't exist.
    req.body = undefined;

    await toNextHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    );

    expect(res.statusCode).toBe(400);
    expect(mockedCreateTransaction).not.toHaveBeenCalled();

    mockedCreateTransaction.mockRestore();
  });

  it("rejects when saleor signature is incorrect", async () => {
    const mockedCreateTransaction = jest
      .spyOn(Avatax.prototype, "createTransaction")
      .mockResolvedValue(dummyFetchTaxesResponse);

    const orderPayload = {
      taxBase: { ...dummyCalculateTaxesPayloadForOrder },
      __typename: "CalculateTaxes",
    };
    // set mock on next built-in library that build the payload from stream.
    const rawBodyModule = require("next/dist/compiled/raw-body/index.js");
    rawBodyModule.default.mockReturnValue({
      toString: () => JSON.stringify(orderPayload),
    });

    const signature = "incorrect-sig";
    const { req, res } = mockRequest({
      method: "POST",
      event: "order_calculate_taxes",
      domain: testDomain,
      signature,
    });

    // set body to undefined as the webhook handler expects that
    // the processed body doesn't exist.
    req.body = undefined;

    await toNextHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    );

    expect(res.statusCode).toBe(400);
    expect(mockedCreateTransaction).not.toHaveBeenCalled();

    mockedCreateTransaction.mockRestore();
  });

  it("fetches taxes for order", async () => {
    const { req, res } = mockRequest({
      method: "POST",
      event: "order_calculate_taxes",
      domain: testDomain,
      signature:
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6..-Y1p0YWNAuX0kOPIhfjoNoyWAkvRl6iMxWQ",
    });

    const mockJose = jest
      .spyOn(joseModule, "flattenedVerify")
      .mockResolvedValue(
        {} as unknown as joseModule.FlattenedVerifyResult &
          joseModule.ResolvedKey
      );

    const orderPayload = {
      taxBase: { ...dummyCalculateTaxesPayloadForOrder },
      __typename: "CalculateTaxes",
    };

    // set mock on next built-in library that build the payload from stream.
    const rawBodyModule = require("next/dist/compiled/raw-body/index.js");
    rawBodyModule.default.mockReturnValue({
      toString: () => JSON.stringify(orderPayload),
    });
    // set body to undefined as the webhook handler expects that
    // the processed body doesn't exist.
    req.body = undefined;

    await toNextHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    );

    const data: ResponseTaxPayload = res._getData();

    expect(data.shipping_price_gross_amount).toBe("12.30");
    expect(data.shipping_price_net_amount).toBe("10.00");
    expect(data.shipping_tax_rate).toBe("23.00");
    expect(data.lines.length).toBe(1);
    expect(data.lines[0].total_gross_amount).toBe("60.00");
    expect(data.lines[0].total_net_amount).toBe("48.78");
    expect(data.lines[0].tax_rate).toBe("23.00");
    expect(res.statusCode).toBe(200);

    mockJose.mockRestore();
  });

  it("propagates discounts over lines", async () => {
    const { req, res } = mockRequest({
      method: "POST",
      event: "order_calculate_taxes",
      domain: testDomain,
      signature:
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6..-Y1p0YWNAuX0kOPIhfjoNoyWAkvRl6iMxWQ",
    });

    const mockJose = jest
      .spyOn(joseModule, "flattenedVerify")
      .mockResolvedValue(
        {} as unknown as joseModule.FlattenedVerifyResult &
          joseModule.ResolvedKey
      );

    const orderPayload = {
      taxBase: { ...dummyCalculateTaxesPayloadForOrder },
      __typename: "CalculateTaxes",
    };
    orderPayload.taxBase.discounts = [
      { amount: { amount: 2 } },
      { amount: { amount: 1 } },
    ];
    const linePayload = { ...orderPayload.taxBase.lines[0] };
    const secondLinePayload = {
      ...linePayload,
      totalPrice: { amount: 20 },
      sourceLine: {
        ...linePayload.sourceLine,
        id: "Q2hlY2tvdXRMaW5lOjc=",
      },
    };
    orderPayload.taxBase.lines = [linePayload, secondLinePayload];

    // set mock on next built-in library that build the payload from stream.
    const rawBodyModule = require("next/dist/compiled/raw-body/index.js");
    rawBodyModule.default.mockReturnValue({
      toString: () => JSON.stringify(orderPayload),
    });
    // set body to undefined as the webhook handler expects that
    // the processed body doesn't exist.
    req.body = undefined;

    await toNextHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    );

    const data: ResponseTaxPayload = res._getData();

    // amounts already include propagated discount
    expect(data.shipping_price_gross_amount).toBe("11.90");
    expect(data.shipping_price_net_amount).toBe("9.67");
    expect(data.shipping_tax_rate).toBe("23.00");

    expect(data.lines[0].total_gross_amount).toBe("58.05");
    expect(data.lines[0].total_net_amount).toBe("47.20");
    expect(data.lines[0].tax_rate).toBe("23.00");

    expect(data.lines[1].total_gross_amount).toBe("19.35");
    expect(data.lines[1].total_net_amount).toBe("15.73");
    expect(data.lines[1].tax_rate).toBe("23.00");
    expect(res.statusCode).toBe(200);

    mockJose.mockRestore();
  });

  it("with lines that have net prices", async () => {
    const { req, res } = mockRequest({
      method: "POST",
      event: "order_calculate_taxes",
      domain: testDomain,
      signature:
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6..-Y1p0YWNAuX0kOPIhfjoNoyWAkvRl6iMxWQ",
    });

    const mockJose = jest
      .spyOn(joseModule, "flattenedVerify")
      .mockResolvedValue(
        {} as unknown as joseModule.FlattenedVerifyResult &
          joseModule.ResolvedKey
      );
    const orderPayload = {
      taxBase: {
        ...dummyCalculateTaxesPayloadForOrder,
        pricesEnteredWithTax: false,
      },
      __typename: "CalculateTaxes",
    };

    orderPayload.taxBase.discounts = [
      { amount: { amount: 2 } },
      { amount: { amount: 1 } },
    ];
    const linePayload = { ...orderPayload.taxBase.lines[0] };
    const secondLinePayload = {
      ...linePayload,
      totalPrice: { amount: 20 },
      sourceLine: {
        ...linePayload.sourceLine,
        id: "Q2hlY2tvdXRMaW5lOjc=",
      },
      chargeTaxes: false,
    };
    orderPayload.taxBase.lines = [linePayload, secondLinePayload];

    // set mock on next built-in library that build the payload from stream.
    const rawBodyModule = require("next/dist/compiled/raw-body/index.js");
    rawBodyModule.default.mockReturnValue({
      toString: () => JSON.stringify(orderPayload),
    });

    // set body to undefined as the webhook handler expects that
    // the processed body doesn't exist.
    req.body = undefined;

    await toNextHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    );

    const data: ResponseTaxPayload = res._getData();

    expect(data.shipping_price_gross_amount).toBe("14.64");
    expect(data.shipping_price_net_amount).toBe("11.90");
    expect(data.shipping_tax_rate).toBe("23.00");

    // amounts already include propagated discount
    expect(data.lines[0].total_gross_amount).toBe("71.40");
    expect(data.lines[0].total_net_amount).toBe("58.05");
    expect(data.lines[0].tax_rate).toBe("23.00");

    expect(data.lines[1].total_gross_amount).toBe("19.35");
    expect(data.lines[1].total_net_amount).toBe("19.35");
    expect(data.lines[1].tax_rate).toBe("0.00");
    expect(res.statusCode).toBe(200);

    mockJose.mockRestore();
  });

  it("with line that should not have calculated taxes", async () => {
    const { req, res } = mockRequest({
      method: "POST",
      event: "order_calculate_taxes",
      domain: testDomain,
      signature:
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6..-Y1p0YWNAuX0kOPIhfjoNoyWAkvRl6iMxWQ",
    });

    const mockJose = jest
      .spyOn(joseModule, "flattenedVerify")
      .mockResolvedValue(
        {} as unknown as joseModule.FlattenedVerifyResult &
          joseModule.ResolvedKey
      );

    const orderPayload = {
      taxBase: { ...dummyCalculateTaxesPayloadForOrder },
      __typename: "CalculateTaxes",
    };

    const linePayload = { ...orderPayload.taxBase.lines[0] };
    const secondLinePayload = {
      ...linePayload,
      sourceLine: {
        ...linePayload.sourceLine,
        id: "Q2hlY2tvdXRMaW5lOjc=",
      },
      chargeTaxes: false,
    };
    orderPayload.taxBase.lines = [linePayload, secondLinePayload];

    // set mock on next built-in library that build the payload from stream.
    const rawBodyModule = require("next/dist/compiled/raw-body/index.js");
    rawBodyModule.default.mockReturnValue({
      toString: () => JSON.stringify(orderPayload),
    });
    // set body to undefined as the webhook handler expects that
    // the processed body doesn't exist.
    req.body = undefined;

    await toNextHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    );

    const data: ResponseTaxPayload = res._getData();

    expect(data.lines[0].total_gross_amount).toBe("60.00");
    expect(data.lines[0].total_net_amount).toBe("48.78");
    expect(data.lines[0].tax_rate).toBe("23.00");

    expect(data.lines[1].total_gross_amount).toBe("60.00");
    expect(data.lines[1].total_net_amount).toBe("60.00");
    expect(data.lines[1].tax_rate).toBe("0.00");

    expect(res.statusCode).toBe(200);

    mockJose.mockRestore();
  });

  it("with discounts and line that should not have calculated taxes", async () => {
    const { req, res } = mockRequest({
      method: "POST",
      event: "order_calculate_taxes",
      domain: testDomain,
      signature:
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6..-Y1p0YWNAuX0kOPIhfjoNoyWAkvRl6iMxWQ",
    });

    const mockJose = jest
      .spyOn(joseModule, "flattenedVerify")
      .mockResolvedValue(
        {} as unknown as joseModule.FlattenedVerifyResult &
          joseModule.ResolvedKey
      );

    const orderPayload = {
      taxBase: { ...dummyCalculateTaxesPayloadForOrder },
      __typename: "CalculateTaxes",
    };
    orderPayload.taxBase.discounts = [
      { amount: { amount: 2 } },
      { amount: { amount: 1 } },
    ];
    const linePayload = { ...orderPayload.taxBase.lines[0] };
    const secondLinePayload = {
      ...linePayload,
      sourceLine: {
        ...linePayload.sourceLine,
        id: "Q2hlY2tvdXRMaW5lOjc=",
      },
      chargeTaxes: false,
    };
    orderPayload.taxBase.lines = [linePayload, secondLinePayload];

    // set mock on next built-in library that build the payload from stream.
    const rawBodyModule = require("next/dist/compiled/raw-body/index.js");
    rawBodyModule.default.mockReturnValue({
      toString: () => JSON.stringify(orderPayload),
    });
    // set body to undefined as the webhook handler expects that
    // the processed body doesn't exist.
    req.body = undefined;

    await toNextHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    );

    const data: ResponseTaxPayload = res._getData();

    // amounts already include propagated discount
    expect(data.shipping_price_gross_amount).toBe("12.02");
    expect(data.shipping_price_net_amount).toBe("9.77");
    expect(data.shipping_tax_rate).toBe("23.00");

    expect(data.lines[0].total_gross_amount).toBe("58.64");
    expect(data.lines[0].total_net_amount).toBe("47.67");
    expect(data.lines[0].tax_rate).toBe("23.00");

    expect(data.lines[1].total_gross_amount).toBe("58.64");
    expect(data.lines[1].total_net_amount).toBe("58.64");
    expect(data.lines[1].tax_rate).toBe("0.00");

    expect(res.statusCode).toBe(200);

    mockJose.mockRestore();
  });

  it("all lines with charge taxes set to false", async () => {
    const { req, res } = mockRequest({
      method: "POST",
      event: "order_calculate_taxes",
      domain: testDomain,
      signature:
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6..-Y1p0YWNAuX0kOPIhfjoNoyWAkvRl6iMxWQ",
    });

    const mockJose = jest
      .spyOn(joseModule, "flattenedVerify")
      .mockResolvedValue(
        {} as unknown as joseModule.FlattenedVerifyResult &
          joseModule.ResolvedKey
      );

    const orderPayload = {
      taxBase: { ...dummyCalculateTaxesPayloadForOrder },
      __typename: "CalculateTaxes",
    };

    const linePayload = {
      ...orderPayload.taxBase.lines[0],
      chargeTaxes: false,
    };
    const secondLinePayload = {
      ...linePayload,
      id: "T3JkZXJMaW5lOjc=",
      charge_taxes: false,
    };
    orderPayload.taxBase.lines = [linePayload, secondLinePayload];

    // set mock on next built-in library that build the payload from stream.
    const rawBodyModule = require("next/dist/compiled/raw-body/index.js");
    rawBodyModule.default.mockReturnValue({
      toString: () => JSON.stringify(orderPayload),
    });
    // set body to undefined as the webhook handler expects that
    // the processed body doesn't exist.
    req.body = undefined;

    await toNextHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    );

    const data: ResponseTaxPayload = res._getData();

    expect(data.lines[0].total_gross_amount).toBe("60.00");
    expect(data.lines[0].total_net_amount).toBe("60.00");
    expect(data.lines[0].tax_rate).toBe("0.00");

    expect(data.lines[1].total_gross_amount).toBe("60.00");
    expect(data.lines[1].total_net_amount).toBe("60.00");
    expect(data.lines[1].tax_rate).toBe("0.00");

    expect(res.statusCode).toBe(200);

    mockJose.mockRestore();
  });
});
