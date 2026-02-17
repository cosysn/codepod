/**
 * Output Formatter
 */

import { Sandbox } from './types';

type OutputFormat = 'json' | 'table' | 'simple';

export class Formatter {
  private format: OutputFormat;

  constructor(format: OutputFormat = 'table') {
    this.format = format;
  }

  /**
   * Set output format
   */
  setFormat(format: OutputFormat): void {
    this.format = format;
  }

  /**
   * Format sandbox list
   */
  formatSandboxList(sandboxes: Sandbox[]): string {
    switch (this.format) {
      case 'json':
        return JSON.stringify(sandboxes, null, 2);
      case 'simple':
        return sandboxes.map(s => `${s.id}\t${s.name}\t${s.status}\t${s.image}`).join('\n');
      case 'table':
      default:
        return this.formatTable(sandboxes);
    }
  }

  /**
   * Format single sandbox
   */
  formatSandbox(sandbox: Sandbox): string {
    switch (this.format) {
      case 'json':
        return JSON.stringify(sandbox, null, 2);
      case 'simple':
        return `${sandbox.id}\t${sandbox.name}\t${sandbox.status}\t${sandbox.image}`;
      case 'table':
      default:
        return this.formatSandboxDetail(sandbox);
    }
  }

  /**
   * Format as table
   */
  private formatTable(sandboxes: Sandbox[]): string {
    if (sandboxes.length === 0) {
      return 'No sandboxes found.';
    }

    const headers = ['ID', 'Name', 'Status', 'Image', 'Created'];
    const rows = sandboxes.map(s => [
      s.id.substring(0, 8),
      s.name,
      s.status,
      s.image,
      new Date(s.createdAt).toLocaleDateString(),
    ]);

    const colWidths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r: string[]) => r[i].length))
    );

    const separator = colWidths.map((w: number) => '-'.repeat(w + 2)).join('+');
    const headerLine = headers.map((h: string, i: number) =>
      ` ${h.padEnd(colWidths[i])} `
    ).join('|');

    const lines = rows.map((row: string[]) =>
      row.map((cell: string, i: number) =>
        ` ${cell.padEnd(colWidths[i])} `
      ).join('|')
    );

    return [separator, `|${headerLine}|`, separator, ...lines, separator].join('\n');
  }

  /**
   * Format sandbox detail
   */
  private formatSandboxDetail(sandbox: Sandbox): string {
    const lines = [
      `ID: ${sandbox.id}`,
      `Name: ${sandbox.name}`,
      `Status: ${sandbox.status}`,
      `Image: ${sandbox.image}`,
      `Host: ${sandbox.host}:${sandbox.port}`,
      `User: ${sandbox.user}`,
      `Created: ${new Date(sandbox.createdAt).toLocaleString()}`,
    ];

    if (sandbox.startedAt) {
      lines.push(`Started: ${new Date(sandbox.startedAt).toLocaleString()}`);
    }

    return lines.join('\n');
  }
}
