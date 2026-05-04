import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Waha Health Care',
    short_name: 'Waha',
    description: 'Healthcare Beneficiary Management System',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#f5f6f8',
    theme_color: '#1f4e8c',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/logo.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/logo.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
