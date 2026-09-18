import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  CircularProgress,
  Alert,
  Card,
} from '@mui/material';
import { sysadminApi } from '../../services/api';
import logger from '../../utils/logger';
import { PrimaryButton, GhostButton } from '../gtacpr/Buttons';
import type { Theme } from '@mui/material/styles';

interface SystemConfig {
  id: number;
  configKey: string;
  configValue: string;
  description: string;
  category: string;
  updatedBy?: number;
  updatedAt: string;
  createdAt: string;
}

interface ConfigurationsByCategory {
  [category: string]: SystemConfig[];
}

const SystemConfiguration: React.FC = () => {
  const [configurations, setConfigurations] = useState<ConfigurationsByCategory>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});

  const loadConfigurations = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await sysadminApi.getConfigurations();
      if (response.data.success) {
        setConfigurations(response.data.data);
        const initialValues: Record<string, string> = {};
        (Object.values(response.data.data).flat() as SystemConfig[]).forEach(config => {
          initialValues[config.configKey] = config.configValue;
        });
        setEditedValues(initialValues);
      } else {
        setError('Failed to load configurations');
      }
    } catch (err) {
      logger.error('Error loading configurations:', err);
      setError('Failed to load system configurations');
    } finally {
      setLoading(false);
    }
  };

  // Mount-time fetch of the configuration list (external API sync, not
  // state derived from render data), so a direct setState inside is
  // expected.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadConfigurations(); }, []);

  const handleValueChange = (key: string, value: string) => {
    setEditedValues(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async (key: string) => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const response = await sysadminApi.updateConfiguration(key, editedValues[key]);
      if (response.data.success) {
        setSuccess(`Configuration '${key}' updated successfully`);
        await loadConfigurations();
      } else {
        setError(`Failed to update ${key}`);
      }
    } catch (err) {
      logger.error(`Error updating configuration ${key}:`, err);
      setError(`Failed to update ${key}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const updatePromises = Object.keys(editedValues).map(key =>
        sysadminApi.updateConfiguration(key, editedValues[key])
      );
      await Promise.all(updatePromises);
      setSuccess('All configurations updated successfully');
      await loadConfigurations();
    } catch (err) {
      logger.error('Error updating configurations:', err);
      setError('Failed to update some configurations');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress size={48} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      {/* Action bar */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
        <GhostButton onClick={loadConfigurations} disabled={loading}>Refresh</GhostButton>
        <PrimaryButton onClick={handleSaveAll} disabled={saving}>
          {saving ? 'Saving...' : 'Save All Changes'}
        </PrimaryButton>
      </Box>

      {/* Category sections */}
      {Object.entries(configurations).map(([category, configs]) => (
        <Box key={category}>
          {/* Category header */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              {category} Settings
            </Typography>
            <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, bgcolor: (theme) => theme.palette.divider, px: 1, py: 0.25, borderRadius: '10px', fontWeight: 600 }}>
              {configs.length}
            </Typography>
          </Box>

          {/* Config cards */}
          <Card sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,.05)', overflow: 'hidden' }}>
            {configs.map((config, i) => (
              <Box
                key={config.configKey}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1.2fr auto',
                  alignItems: 'center',
                  gap: 3,
                  px: 3,
                  py: 2,
                  borderBottom: i < configs.length - 1 ? (theme: Theme) => `1px solid ${theme.palette.divider}` : 'none',
                }}
              >
                {/* Label + description */}
                <Box>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {config.configKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: (theme) => theme.palette.text.secondary, mt: 0.25 }}>
                    {config.description}
                  </Typography>
                </Box>

                {/* Value input */}
                <TextField
                  fullWidth
                  size="small"
                  value={editedValues[config.configKey] || config.configValue}
                  onChange={(e) => handleValueChange(config.configKey, e.target.value)}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '8px',
                      fontSize: 13,
                      '& fieldset': { borderColor: (theme: Theme) => theme.palette.divider },
                      '&:hover fieldset': { borderColor: (theme: Theme) => theme.palette.text.secondary },
                      '&.Mui-focused fieldset': { borderColor: '#CC1F1F' },
                    },
                  }}
                />

                {/* Save + timestamp */}
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
                  <Box
                    onClick={() => !saving && handleSave(config.configKey)}
                    sx={{
                      fontSize: 12, fontWeight: 600, color: '#CC1F1F', cursor: saving ? 'default' : 'pointer',
                      opacity: saving ? 0.5 : 1,
                      '&:hover': saving ? {} : { textDecoration: 'underline' },
                    }}
                  >
                    Save
                  </Box>
                  {config.updatedAt && (
                    <Typography sx={{ fontSize: 10.5, color: (theme) => theme.palette.text.secondary }}>
                      {new Date(config.updatedAt).toLocaleDateString()}
                    </Typography>
                  )}
                </Box>
              </Box>
            ))}
          </Card>
        </Box>
      ))}
    </Box>
  );
};

export default SystemConfiguration;
