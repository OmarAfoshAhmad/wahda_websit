export function getServiceAlias(company: { service_aliases?: any } | null | undefined, serviceType: 'DENTAL' | 'OPTICS', defaultName: string): string {
  if (!company || !company.service_aliases) {
    return defaultName;
  }
  
  try {
    const aliases = typeof company.service_aliases === 'string' 
      ? JSON.parse(company.service_aliases) 
      : company.service_aliases;
      
    if (aliases && aliases[serviceType]) {
      return aliases[serviceType];
    }
  } catch (e) {
    // ignore parse errors
  }
  
  return defaultName;
}
