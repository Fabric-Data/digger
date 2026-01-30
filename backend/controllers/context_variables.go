package controllers

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strconv"

	"github.com/diggerhq/digger/backend/middleware"
	"github.com/diggerhq/digger/backend/models"
	"github.com/diggerhq/digger/backend/utils"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ListContextVariablesApi lists all context variables for an organization
func ListContextVariablesApi(c *gin.Context) {
	organisationId := c.GetString(middleware.ORGANISATION_ID_KEY)
	organisationSource := c.GetString(middleware.ORGANISATION_SOURCE_KEY)

	var org models.Organisation
	err := models.DB.GormDB.Where("external_id = ? AND external_source = ?", organisationId, organisationSource).First(&org).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			slog.Info("Organisation not found", "organisationId", organisationId, "source", organisationSource)
			c.String(http.StatusNotFound, "Could not find organisation: "+organisationId)
		} else {
			slog.Error("Error fetching organisation", "organisationId", organisationId, "source", organisationSource, "error", err)
			c.String(http.StatusInternalServerError, "Error fetching organisation")
		}
		return
	}

	variables, err := models.DB.GetContextVariablesByOrg(org.ID)
	if err != nil {
		slog.Error("Error fetching context variables", "organisationId", organisationId, "orgId", org.ID, "error", err)
		c.String(http.StatusInternalServerError, "Unknown error occurred while fetching context variables")
		return
	}

	// Map to JSON and decrypt non-secret values
	secret := os.Getenv("DIGGER_ENCRYPTION_SECRET")
	var key []byte
	if secret != "" {
		key, err = base64.StdEncoding.DecodeString(secret)
		if err != nil {
			slog.Error("Failed to decode encryption key", "error", err)
		}
	}

	marshalledVars := make([]interface{}, 0)
	for _, v := range variables {
		marshalled := v.MapToJsonStruct()
		
		// Add decrypted value for non-secret variables
		if !v.IsSecret && v.ValueEncrypted != "" && len(key) > 0 {
			decryptedValue, err := utils.AESDecrypt(key, v.ValueEncrypted)
			if err != nil {
				slog.Error("Failed to decrypt value", "variableId", v.ID, "error", err)
			} else {
				// Add value to the marshalled struct
				if m, ok := marshalled.(map[string]interface{}); ok {
					m["value"] = decryptedValue
				} else {
					// Try type assertion to the struct type
					type tempStruct struct {
						Id                     uint    `json:"id"`
						Name                   string  `json:"name"`
						IsSecret               bool    `json:"is_secret"`
						Value                  string  `json:"value,omitempty"`
						RepoID                 *uint   `json:"repo_id"`
						RepoFullName           string  `json:"repo_full_name,omitempty"`
						OrganisationID         uint    `json:"organisation_id"`
						ProjectNameFilter      *string `json:"project_name_filter"`
						ProjectDirectoryFilter *string `json:"project_directory_filter"`
					}
					// Convert to map for modification
					bytes, _ := json.Marshal(marshalled)
					var temp tempStruct
					json.Unmarshal(bytes, &temp)
					temp.Value = decryptedValue
					marshalled = temp
				}
			}
		}
		
		marshalledVars = append(marshalledVars, marshalled)
	}

	slog.Info("Successfully fetched context variables", "organisationId", organisationId, "orgId", org.ID, "count", len(variables))

	response := make(map[string]interface{})
	response["result"] = marshalledVars

	c.JSON(http.StatusOK, response)
}

// CreateContextVariableApi creates a new context variable
func CreateContextVariableApi(c *gin.Context) {
	organisationId := c.GetString(middleware.ORGANISATION_ID_KEY)
	organisationSource := c.GetString(middleware.ORGANISATION_SOURCE_KEY)

	var org models.Organisation
	err := models.DB.GormDB.Where("external_id = ? AND external_source = ?", organisationId, organisationSource).First(&org).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			slog.Info("Organisation not found", "organisationId", organisationId, "source", organisationSource)
			c.String(http.StatusNotFound, "Could not find organisation: "+organisationId)
		} else {
			slog.Error("Error fetching organisation", "organisationId", organisationId, "source", organisationSource, "error", err)
			c.String(http.StatusInternalServerError, "Error fetching organisation")
		}
		return
	}

	var reqBody struct {
		Name                   string  `json:"name" binding:"required"`
		Value                  string  `json:"value" binding:"required"`
		IsSecret               bool    `json:"is_secret"`
		RepoID                 *uint   `json:"repo_id"`
		ProjectNameFilter      *string `json:"project_name_filter"`
		ProjectDirectoryFilter *string `json:"project_directory_filter"`
	}

	err = json.NewDecoder(c.Request.Body).Decode(&reqBody)
	if err != nil {
		slog.Error("Error decoding request body", "error", err)
		c.String(http.StatusBadRequest, "Invalid request body")
		return
	}

	// Encrypt the value
	secret := os.Getenv("DIGGER_ENCRYPTION_SECRET")
	if secret == "" {
		slog.Error("No encryption secret specified")
		c.String(http.StatusInternalServerError, "Server configuration error: encryption not configured")
		return
	}

	key, err := base64.StdEncoding.DecodeString(secret)
	if err != nil {
		slog.Error("Failed to decode encryption key", "error", err)
		c.String(http.StatusInternalServerError, "Server configuration error")
		return
	}

	encryptedValue, err := utils.AESEncrypt(key, reqBody.Value)
	if err != nil {
		slog.Error("Failed to encrypt value", "error", err)
		c.String(http.StatusInternalServerError, "Failed to encrypt value")
		return
	}

	// Validate repo if specified
	if reqBody.RepoID != nil {
		var repo models.Repo
		err = models.DB.GormDB.Where("id = ? AND organisation_id = ?", *reqBody.RepoID, org.ID).First(&repo).Error
		if err != nil {
			slog.Error("Repo not found or not owned by org", "repoId", *reqBody.RepoID, "orgId", org.ID)
			c.String(http.StatusBadRequest, "Invalid repo_id")
			return
		}
	}

	variable := models.ContextVariable{
		Name:                   reqBody.Name,
		ValueEncrypted:         encryptedValue,
		IsSecret:               reqBody.IsSecret,
		RepoID:                 reqBody.RepoID,
		OrganisationID:         org.ID,
		ProjectNameFilter:      reqBody.ProjectNameFilter,
		ProjectDirectoryFilter: reqBody.ProjectDirectoryFilter,
	}

	err = models.DB.CreateContextVariable(&variable)
	if err != nil {
		slog.Error("Failed to create context variable", "error", err)
		c.String(http.StatusInternalServerError, "Failed to create context variable")
		return
	}

	slog.Info("Created context variable", "id", variable.ID, "name", variable.Name, "orgId", org.ID)
	c.JSON(http.StatusCreated, variable.MapToJsonStruct())
}

// GetContextVariableApi gets a specific context variable by ID
func GetContextVariableApi(c *gin.Context) {
	organisationId := c.GetString(middleware.ORGANISATION_ID_KEY)
	organisationSource := c.GetString(middleware.ORGANISATION_SOURCE_KEY)
	variableId := c.Param("variable_id")

	var org models.Organisation
	err := models.DB.GormDB.Where("external_id = ? AND external_source = ?", organisationId, organisationSource).First(&org).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			slog.Info("Organisation not found", "organisationId", organisationId, "source", organisationSource)
			c.String(http.StatusNotFound, "Could not find organisation: "+organisationId)
		} else {
			slog.Error("Error fetching organisation", "organisationId", organisationId, "source", organisationSource, "error", err)
			c.String(http.StatusInternalServerError, "Error fetching organisation")
		}
		return
	}

	id, err := strconv.ParseUint(variableId, 10, 32)
	if err != nil {
		slog.Error("Invalid variable ID", "variableId", variableId, "error", err)
		c.String(http.StatusBadRequest, "Invalid variable ID")
		return
	}

	variable, err := models.DB.GetContextVariableById(uint(id))
	if err != nil {
		slog.Error("Failed to fetch context variable", "variableId", id, "error", err)
		c.String(http.StatusNotFound, "Context variable not found")
		return
	}

	// Verify ownership
	if variable.OrganisationID != org.ID {
		slog.Warn("Unauthorized access attempt", "variableId", id, "orgId", org.ID, "variableOrgId", variable.OrganisationID)
		c.String(http.StatusForbidden, "Not authorized to access this variable")
		return
	}

	c.JSON(http.StatusOK, variable.MapToJsonStruct())
}

// UpdateContextVariableApi updates a context variable
func UpdateContextVariableApi(c *gin.Context) {
	organisationId := c.GetString(middleware.ORGANISATION_ID_KEY)
	organisationSource := c.GetString(middleware.ORGANISATION_SOURCE_KEY)
	variableId := c.Param("variable_id")

	var org models.Organisation
	err := models.DB.GormDB.Where("external_id = ? AND external_source = ?", organisationId, organisationSource).First(&org).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			slog.Info("Organisation not found", "organisationId", organisationId, "source", organisationSource)
			c.String(http.StatusNotFound, "Could not find organisation: "+organisationId)
		} else {
			slog.Error("Error fetching organisation", "organisationId", organisationId, "source", organisationSource, "error", err)
			c.String(http.StatusInternalServerError, "Error fetching organisation")
		}
		return
	}

	id, err := strconv.ParseUint(variableId, 10, 32)
	if err != nil {
		slog.Error("Invalid variable ID", "variableId", variableId, "error", err)
		c.String(http.StatusBadRequest, "Invalid variable ID")
		return
	}

	variable, err := models.DB.GetContextVariableById(uint(id))
	if err != nil {
		slog.Error("Failed to fetch context variable", "variableId", id, "error", err)
		c.String(http.StatusNotFound, "Context variable not found")
		return
	}

	// Verify ownership
	if variable.OrganisationID != org.ID {
		slog.Warn("Unauthorized access attempt", "variableId", id, "orgId", org.ID, "variableOrgId", variable.OrganisationID)
		c.String(http.StatusForbidden, "Not authorized to access this variable")
		return
	}

	var reqBody struct {
		Name                   *string `json:"name"`
		Value                  *string `json:"value"`
		IsSecret               *bool   `json:"is_secret"`
		RepoID                 *uint   `json:"repo_id"`
		ProjectNameFilter      *string `json:"project_name_filter"`
		ProjectDirectoryFilter *string `json:"project_directory_filter"`
	}

	err = json.NewDecoder(c.Request.Body).Decode(&reqBody)
	if err != nil {
		slog.Error("Error decoding request body", "error", err)
		c.String(http.StatusBadRequest, "Invalid request body")
		return
	}

	// Update fields
	if reqBody.Name != nil {
		variable.Name = *reqBody.Name
	}

	if reqBody.Value != nil {
		// Encrypt the new value
		secret := os.Getenv("DIGGER_ENCRYPTION_SECRET")
		if secret == "" {
			slog.Error("No encryption secret specified")
			c.String(http.StatusInternalServerError, "Server configuration error: encryption not configured")
			return
		}

		key, err := base64.StdEncoding.DecodeString(secret)
		if err != nil {
			slog.Error("Failed to decode encryption key", "error", err)
			c.String(http.StatusInternalServerError, "Server configuration error")
			return
		}

		encryptedValue, err := utils.AESEncrypt(key, *reqBody.Value)
		if err != nil {
			slog.Error("Failed to encrypt value", "error", err)
			c.String(http.StatusInternalServerError, "Failed to encrypt value")
			return
		}

		variable.ValueEncrypted = encryptedValue
	}

	if reqBody.IsSecret != nil {
		variable.IsSecret = *reqBody.IsSecret
	}

	if reqBody.RepoID != nil {
		// Validate repo if specified
		var repo models.Repo
		err = models.DB.GormDB.Where("id = ? AND organisation_id = ?", *reqBody.RepoID, org.ID).First(&repo).Error
		if err != nil {
			slog.Error("Repo not found or not owned by org", "repoId", *reqBody.RepoID, "orgId", org.ID)
			c.String(http.StatusBadRequest, "Invalid repo_id")
			return
		}
		variable.RepoID = reqBody.RepoID
	}

	if reqBody.ProjectNameFilter != nil {
		variable.ProjectNameFilter = reqBody.ProjectNameFilter
	}

	if reqBody.ProjectDirectoryFilter != nil {
		variable.ProjectDirectoryFilter = reqBody.ProjectDirectoryFilter
	}

	err = models.DB.UpdateContextVariable(variable)
	if err != nil {
		slog.Error("Failed to update context variable", "variableId", id, "error", err)
		c.String(http.StatusInternalServerError, "Failed to update context variable")
		return
	}

	slog.Info("Updated context variable", "id", variable.ID, "name", variable.Name)
	c.JSON(http.StatusOK, variable.MapToJsonStruct())
}

// DeleteContextVariableApi deletes a context variable
func DeleteContextVariableApi(c *gin.Context) {
	organisationId := c.GetString(middleware.ORGANISATION_ID_KEY)
	organisationSource := c.GetString(middleware.ORGANISATION_SOURCE_KEY)
	variableId := c.Param("variable_id")

	var org models.Organisation
	err := models.DB.GormDB.Where("external_id = ? AND external_source = ?", organisationId, organisationSource).First(&org).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			slog.Info("Organisation not found", "organisationId", organisationId, "source", organisationSource)
			c.String(http.StatusNotFound, "Could not find organisation: "+organisationId)
		} else {
			slog.Error("Error fetching organisation", "organisationId", organisationId, "source", organisationSource, "error", err)
			c.String(http.StatusInternalServerError, "Error fetching organisation")
		}
		return
	}

	id, err := strconv.ParseUint(variableId, 10, 32)
	if err != nil {
		slog.Error("Invalid variable ID", "variableId", variableId, "error", err)
		c.String(http.StatusBadRequest, "Invalid variable ID")
		return
	}

	variable, err := models.DB.GetContextVariableById(uint(id))
	if err != nil {
		slog.Error("Failed to fetch context variable", "variableId", id, "error", err)
		c.String(http.StatusNotFound, "Context variable not found")
		return
	}

	// Verify ownership
	if variable.OrganisationID != org.ID {
		slog.Warn("Unauthorized access attempt", "variableId", id, "orgId", org.ID, "variableOrgId", variable.OrganisationID)
		c.String(http.StatusForbidden, "Not authorized to access this variable")
		return
	}

	err = models.DB.DeleteContextVariable(uint(id))
	if err != nil {
		slog.Error("Failed to delete context variable", "variableId", id, "error", err)
		c.String(http.StatusInternalServerError, "Failed to delete context variable")
		return
	}

	slog.Info("Deleted context variable", "id", id)
	c.JSON(http.StatusOK, gin.H{"message": "Context variable deleted successfully"})
}
