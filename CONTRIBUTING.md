# Contributing to LLM Proxy Babylon

Thanks for your interest in contributing! This project aims to bridge the multilingual quality gap in LLMs, and contributions from the community are welcome.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/llm-proxy-babylon.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b my-feature`
5. Make your changes
6. Run tests: `npm test`
7. Commit and push
8. Open a Pull Request

## Development Setup

```bash
npm install
npm test          # run all 141 tests
npm start         # start the proxy server (requires AWS credentials for Bedrock)
```

## What We're Looking For

- New translation backends (DeepL, Google Translate)
- Language resource tier classification
- Dialect detection improvements
- Cost-aware routing logic
- Better content classification heuristics
- Documentation improvements
- Bug fixes

## Code Style

- TypeScript with strict mode
- Use `.ts` extensions in imports
- Property-based tests with fast-check for correctness properties
- Keep components self-contained in `src/components/`

## Testing

Every correctness property from the design document should be covered by a property-based test. When adding new features:

- Add property-based tests for universal correctness guarantees
- Add unit tests for specific edge cases
- Run the full suite before submitting: `npm test`

## Pull Request Process

1. Ensure all tests pass
2. Update the README if your change affects the public API or configuration
3. Describe what your PR does and why
4. Link any related issues

## Reporting Bugs

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (Node version, OS, LLM provider)

## Questions?

Open a discussion or issue — happy to help.
