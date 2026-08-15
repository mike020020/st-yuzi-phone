let scopeHostProvider = null;

export function configurePublicScopeHost(provider) {
    scopeHostProvider = typeof provider === 'function' ? provider : null;
}

export function getConfiguredScopeHost() {
    return scopeHostProvider?.() || null;
}

export function clearPublicScopeHost() {
    scopeHostProvider = null;
}
