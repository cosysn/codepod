export interface ParsedImage {
  registry: string;
  repository: string;
  tag: string;
  fullName: string;
}

export class ImageParser {
  parse(imageName: string): ParsedImage {
    // Handle image name format: [registry/][namespace/]repository[:tag]
    let registry = 'docker.io';
    let repository = imageName;
    let tag = 'latest';

    // Check for tag
    const tagIndex = repository.lastIndexOf(':');
    if (tagIndex !== -1) {
      const potentialTag = repository.substring(tagIndex + 1);
      // Check if it's a tag (not a port in registry)
      if (!potentialTag.includes('/')) {
        tag = potentialTag;
        repository = repository.substring(0, tagIndex);
      }
    }

    // Check for registry (contains /)
    if (repository.includes('/')) {
      const parts = repository.split('/');
      const potentialRegistry = parts[0];
      if (potentialRegistry.includes('.') || potentialRegistry === 'localhost' || potentialRegistry.includes(':')) {
        registry = potentialRegistry;
        repository = parts.slice(1).join('/');
      }
    }

    // Handle docker.io library prefix
    if (repository === 'library' || repository.startsWith('library/')) {
      repository = repository.replace('library/', '');
    }

    const fullName = registry === 'docker.io'
      ? `${repository}:${tag}`
      : `${registry}/${repository}:${tag}`;

    return { registry, repository, tag, fullName };
  }
}
