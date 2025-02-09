import { describe, expect, it } from "vitest";
import {
  AgentId,
  AgentPoolTypeId,
  agentIdToString,
  agentPoolTypeIdToString,
  stringToAgentId,
  stringAgentIdToAgentPoolTypeId,
} from "./agent-id.js";
import { AgentKindSchema } from "./agent-registry.js";

describe("Agent ID Functions", () => {
  describe("agentPoolIdToString", () => {
    it("should convert AgentPoolId to string format", () => {
      const agentPoolId: AgentPoolTypeId = {
        agentKind: AgentKindSchema.Values.operator,
        agentType: "worker",
      };

      expect(agentPoolTypeIdToString(agentPoolId)).toBe("operator:worker");
    });

    it("should handle different agent kinds and types", () => {
      const cases: [AgentPoolTypeId, string][] = [
        [{ agentKind: AgentKindSchema.Values.operator, agentType: "test" }, "operator:test"],
        [{ agentKind: AgentKindSchema.Values.supervisor, agentType: "api" }, "supervisor:api"],
        [
          { agentKind: AgentKindSchema.Values.operator, agentType: "special-type" },
          "operator:special-type",
        ],
      ];

      cases.forEach(([input, expected]) => {
        expect(agentPoolTypeIdToString(input)).toBe(expected);
      });
    });
  });

  describe("stringToAgentPoolId", () => {
    it("should convert string to AgentPoolId", () => {
      const result = stringAgentIdToAgentPoolTypeId("operator:worker");

      expect(result).toEqual({
        agentKind: AgentKindSchema.Values.operator,
        agentType: "worker",
      });
    });

    it("should handle strings with brackets", () => {
      const result = stringAgentIdToAgentPoolTypeId("operator:worker[1]");

      expect(result).toEqual({
        agentKind: AgentKindSchema.Values.operator,
        agentType: "worker",
      });
    });

    it("should handle different formats", () => {
      const cases = [
        ["supervisor:api", { agentKind: AgentKindSchema.Values.supervisor, agentType: "api" }],
        ["operator:test[5]", { agentKind: AgentKindSchema.Values.operator, agentType: "test" }],
      ];

      cases.forEach(([input, expected]) => {
        expect(stringAgentIdToAgentPoolTypeId(input as string)).toEqual(expected);
      });
    });
  });

  describe("agentIdToString", () => {
    it("should convert AgentId to string format", () => {
      const agentId: AgentId = {
        agentKind: AgentKindSchema.Values.operator,
        agentType: "worker",
        num: 1,
      };

      expect(agentIdToString(agentId)).toBe("operator:worker[1]");
    });

    it("should handle different agent numbers", () => {
      const cases: [AgentId, string][] = [
        [
          { agentKind: AgentKindSchema.Values.operator, agentType: "test", num: 0 },
          "operator:test[0]",
        ],
        [
          { agentKind: AgentKindSchema.Values.supervisor, agentType: "api", num: 999 },
          "supervisor:api[999]",
        ],
        [
          { agentKind: AgentKindSchema.Values.operator, agentType: "worker", num: -1 },
          "operator:worker[-1]",
        ],
      ];

      cases.forEach(([input, expected]) => {
        expect(agentIdToString(input)).toBe(expected);
      });
    });
  });

  describe("stringToAgentId", () => {
    it("should convert string to AgentId", () => {
      const result = stringToAgentId("operator:worker[1]");

      expect(result).toEqual({
        agentKind: AgentKindSchema.Values.operator,
        agentType: "worker",
        num: 1,
      });
    });

    it("should handle various formats", () => {
      const cases = [
        [
          "supervisor:api[5]",
          { agentKind: AgentKindSchema.Values.supervisor, agentType: "api", num: 5 },
        ],
        [
          `operator:test[-1]`,
          { agentKind: AgentKindSchema.Values.operator, agentType: "test", num: -1 },
        ],
        [
          "operator:worker[0]",
          { agentKind: AgentKindSchema.Values.operator, agentType: "worker", num: 0 },
        ],
      ];

      cases.forEach(([input, expected]) => {
        expect(stringToAgentId(input as string)).toEqual(expected);
      });
    });
  });
});
